import { myLogger } from '../logger';
import * as mqtt from 'mqtt';
import { DeviceNode, HomieStats, MqttMessage, MqttServerConfig, NodeProperty, OnMessageHandler } from './interfaces';
import { interval, ReplaySubject } from 'rxjs';
import { HomieDevice } from './homie-device';

interface DeviceMap {
    [key: string]: HomieDevice;
}

interface NodeNameWithProperties {
    name?: string;
    properties: Array<NodeProperty>;
}

export class MqttConvertToHomieService implements OnMessageHandler {

    senderClient: mqtt.MqttClient;

    private readonly devices: DeviceMap = {};
    private readonly baseHomieTopic = 'homie';

    private static guessType(value: any): string {
        switch (typeof value) {
            case 'number':
                return 'float';
            case 'boolean':
                return 'boolean';
            default:
                return 'string';
        }
    }

    private static isSkipTopic(topic: string): boolean {
        return topic.includes('STATUS') && !topic.endsWith('STATUS') || topic.endsWith('RESULT');
    }

    private static getDeviceName(baseTopic: string, topic: string): string {
        const remainingTopicParts = MqttConvertToHomieService.getSubTopics(baseTopic, topic);

        return remainingTopicParts[0];
    }

    private static getSubTopics(baseTopic: string, topic: string): Array<string> {
        const base = baseTopic.replace('#', '');

        return topic.replace(base, '')
            .split('/');
    }

    private static isJsonMessage(message: string): boolean {
        return message.startsWith('{') && message.endsWith('}');
    }

    constructor(private readonly homieMqttConfig: MqttServerConfig,
                private readonly sourceMqttConfig?: MqttServerConfig,
                private requiredNodes: Array<string> = []) {
        if (!this.sourceMqttConfig) {
            this.sourceMqttConfig = this.homieMqttConfig;
        }
        interval(5 * 60 * 1000)
            .subscribe(() => {
                myLogger.info('Resending the whole Homie structure');
                this.resendHomieStructure();
            });
    }

    onMessage(baseTopic: string, topic: string, msg: string): void {
        if (MqttConvertToHomieService.isSkipTopic(topic)) {
            return;
        }
        const message = msg.toString();
        const deviceName = MqttConvertToHomieService.getDeviceName(baseTopic, topic);

        myLogger.debug(`message received ${baseTopic} ${topic}, ${message} device ${deviceName}`);

        let homieDevice: HomieDevice;
        homieDevice = this.devices[deviceName];
        if (!homieDevice) {
            if (topic.startsWith('stat/') && topic.endsWith('STATUS')) {
                homieDevice = this.createAndRegisterDevice(deviceName, message);
            } else if (topic.includes('zigbee2mqtt')) {
                homieDevice = this.createAndRegisterDevice(deviceName, message);
            } else {
                myLogger.debug(`Could not add device ${deviceName}, waiting for a stat/*/STATUS - message`);

                return;
            }
        }

        if (!homieDevice) {
            return;
        }

        const subTopics = MqttConvertToHomieService.getSubTopics(baseTopic, topic);
        const nodeId = subTopics[1] || 'requiredNode';
        const node = this.findOrAddNodeForMessage(homieDevice, nodeId, message);
        homieDevice.sendNodePropertyValues(node);
    }

    private createAndRegisterDevice(deviceName: string, message: string): HomieDevice {
        if (!message || !MqttConvertToHomieService.isJsonMessage(message)) {
            return undefined;
        }
        const subj = new ReplaySubject<MqttMessage>(1000, 5000);
        const jsonMessage = JSON.parse(message);
        const friendlyName = jsonMessage?.Status?.FriendlyName.length === 1 ? jsonMessage?.Status?.FriendlyName[0] : deviceName;

        const stats: HomieStats = {
            firstSeen: new Date(),
            interval: 120,
            battery: 100,
            voltage: 0,
            lastSeen: new Date(),
            signal: 0,
            uptime: 0
        };
        const deviceTopic = `${this.baseHomieTopic}/${deviceName}`;
        const client = mqtt.connect(this.homieMqttConfig.brokerUrl, {
            clientId: `General Purpose Mqtt To Homie writer for ${deviceName}`,
            keepalive: 60,
            password: this.homieMqttConfig.password,
            username: this.homieMqttConfig.username,
            resubscribe: true,
            reconnectPeriod: 2000,
            will: {topic: `${deviceTopic}/$state`, payload: 'lost', qos: 1, retain: true}
        });
        const homieDevice = new HomieDevice({
            id: deviceName,
            name: friendlyName ?? deviceName,
            nodes: [],
            messagesToSend: subj,
            stats: stats,
            currentState: 'init',
            deviceTopic: deviceTopic,
            requiredNodes: this.requiredNodes,
            mqttClient: client
        });

        client.on('connect', () => {
            myLogger.info(`Connected for device ${deviceName}`);
            subj.subscribe(msg => {
                if (msg.logLevel === 'info') {
                    myLogger.info(`Sending to ${msg.topic}: ${msg.message} for ${deviceName}`);
                } else {
                    myLogger.silly(`Sending to ${msg.topic}: ${msg.message} for ${deviceName}`);
                }
                const opts: mqtt.IClientPublishOptions = {retain: true, qos: 1};
                client.publish(msg.topic, msg.message.toString(), opts, (error => {
                    if (error) {
                        myLogger.error(`An error has occurred while sending a message to topic ${msg.topic}: ${error}`);
                    }
                }));
            });

            client.on('message', (topic: string, homieMsg: string) => {
                this.handleHomieMessage(topic, homieMsg.toString());
            });
        });

        homieDevice.init();

        return this.devices[deviceName] = homieDevice;
    }

    private findOrAddNodeForMessage(homieDevice: HomieDevice, nodeId: string, message: string): DeviceNode {
        const nodeNameWithProperties = this.disassembleMessage(message, nodeId);
        const applyProperties = (node: DeviceNode) => nodeNameWithProperties.properties
            .map(p => ({
                ...p,
                propertyTopic: `${node.nodeTopic}/${p.name}`,
                commandTopic: p.settable ? `cmnd/${homieDevice.id}/${node.nodeId}` : undefined
            }));

        const node = homieDevice.getNodeById(nodeId);
        if (node) {
            node.properties = applyProperties(node);

            return node;
        }

        myLogger.debug(`Adding previously unknown node ${nodeId} for device ${homieDevice.id}`);

        return homieDevice.addNode(nodeId, nodeNameWithProperties.name, applyProperties);
    }

    private disassembleMessage(msg: string, nodeName?: string): NodeNameWithProperties {
        const message = msg.toString();
        myLogger.silly(`Disassemble message ${message}`);
        if (!MqttConvertToHomieService.isJsonMessage(message)) {
            let name = 'value';
            let type = 'string';
            let value: any = message;
            let settable: boolean;

            const match = nodeName.match(/POWER(.*)/);
            if (!!match) {
                name = `powerSwitch${match[1]}`;
                type = 'boolean';
                settable = true;
                value = message === 'ON';
            }

            return {properties: [{name, type, settable, value}]};
        }
        let jsonMessage = JSON.parse(message);
        const properties = new Array<NodeProperty>();
        const msgKeys = Object.keys(jsonMessage);
        let name;
        if (msgKeys.length === 1) {
            name = msgKeys[0];
            jsonMessage = jsonMessage[msgKeys[0]];
        }
        this.flattenObject('', jsonMessage, properties, nodeName);

        myLogger.silly(`Disassembled message ${message} contains ${properties.length} properties`);

        return {name: name, properties: properties};
    }

    private flattenObject(prefix: string, value: any, properties: Array<NodeProperty>, nodeName: string): void {
        Object.keys(value)
            .forEach(key => {
                let valueVal = value[key];
                const keyForValue = Array.isArray(value) ? (parseInt(key, 10) + 1).toString() : key;
                const valueKey = prefix ? `${prefix}${keyForValue}` : keyForValue;
                if (typeof valueVal === 'object' && (!Array.isArray(valueVal) || nodeName === 'SENSOR')) {
                    this.flattenObject(valueKey, valueVal, properties, nodeName);
                } else {
                    if (Array.isArray(valueVal)) {
                        valueVal = valueVal.join(', ');
                    }
                    properties.push(
                        {
                            name: valueKey,
                            type: MqttConvertToHomieService.guessType(valueVal),
                            value: valueVal
                        }
                    );
                }
            });
    }

    private handleHomieMessage(topic: string, homieMsg: string): void {
        if (!topic.endsWith('set') || homieMsg === '') {
            return;
        }
        myLogger.info(`homie set message received ${topic}, ${homieMsg}`);
        const propertyTopic = topic.replace(/\/set/, '');

        const subtopics = MqttConvertToHomieService.getSubTopics('homie/#', topic);
        const deviceId = subtopics[0];
        const nodeId = subtopics[1];
        const device = this.devices[deviceId];
        const property = device
            ?.nodes
            ?.find(n => n.nodeId === nodeId)
            ?.properties
            ?.find(p => p.propertyTopic === propertyTopic);

        if (property?.commandTopic) {
            const msg = property.name === 'powerSwitch' ? (homieMsg === 'true' ? 'ON' : 'OFF') : homieMsg;
            // Send to tasmota topic
            this.senderClient.publish(property.commandTopic, msg);
            // "clear" set topic of homie device
            device.messagesToSend.next({topic, message: ''});
        } else {
            myLogger.warn(`Could not send message received on topic ${topic}, ${homieMsg} property: ${property}`);
        }
    }

    private resendHomieStructure(): void {
        Object.keys(this.devices)
            .forEach(key => {
                this.devices[key].resendHomieStructure();
            });
    }
}
