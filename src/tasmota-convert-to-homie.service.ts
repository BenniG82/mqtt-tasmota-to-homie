import { myLogger } from './logger';
import * as mqtt from 'mqtt';
import { MqttServerConfig, OnMessageHandler } from './interfaces';
import { ReplaySubject, Subject, timer } from 'rxjs';

interface MessageProperty {
    name: string;
    type: string;
    value: any;
    format?: string;
    settable?: boolean;
    propertyTopic?: string;
    commandTopic?: string;
}

interface MqttMessage {
    message: string;
    topic: string;
    logLevel?: string;
}

interface HomieStats {
    interval: number;
    uptime: number;
    signal: number;
    voltage: number;
    battery: number;
    firstSeen: Date;
    lastSeen: Date;
}

interface HomieDevice {
    initializedNodes?: Array<string>;
    messagesToSend: Subject<MqttMessage>;
    requiredNodes: Array<string>;
    stats: HomieStats;
    nodes: Array<DeviceNode>;
    id: string;
    name: string;
    deviceTopic: string;
    state: 'init' | 'ready';
}

interface DeviceMap {
    [key: string]: HomieDevice;
}

interface DeviceWithNode {
    deviceName: string;
    sourceTopic: string;
    deviceTopic: string;
}

interface DeviceNode {
    nodeId: string;
    nodeName: string;
    nodeTopic: string;
    device: HomieDevice;
    properties?: Array<MessageProperty>;
}

interface NodeNameWithProperties {
    name?: string;
    properties: Array<MessageProperty>;
}

export class TasmotaConvertToHomieService implements OnMessageHandler {

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

    private static updateStats(homieDevice: HomieDevice, property: MessageProperty): void {
        if (property.name === 'battery') {
            homieDevice.stats.battery = property.value;
        } else if (property.name === 'linkquality') {
            homieDevice.stats.signal = property.value;
        } else if (property.name === 'voltage') {
            homieDevice.stats.voltage = property.value;
        }
    }

    constructor(private readonly homieMqttConfig: MqttServerConfig, private readonly sourceMqttConfig?: MqttServerConfig) {
        if (!this.sourceMqttConfig) {
            this.sourceMqttConfig = this.homieMqttConfig;
        }
    }

    onMessage(baseTopic: string, topic: string, msg: string): void {
        // if (!topic.includes('dg-02')) {
        //     return;
        // }
        if (this.isSkipTopic(topic)) {
            return;
        }
        const message = msg.toString();
        const deviceName = this.getDeviceName(baseTopic, topic);

        // const device = this.getDevice(baseTopic, topic);
        // const remainingTopic = topic.replace(`${device.sourceTopic}/`, '');
        // const node = TasmotaConvertToHomieService.getNode(device, remainingTopic, message);

        myLogger.debug(`message received ${baseTopic} ${topic}, ${message} device ${deviceName}`);

        let initializedDevice: HomieDevice;
        initializedDevice = this.devices[deviceName];
        if (!initializedDevice) {
            if (topic.startsWith('stat/') && topic.endsWith('STATUS')) {
                initializedDevice = this.addDevice(deviceName, message);
            } else {
                myLogger.debug(`Could not add device ${deviceName}, waiting for a stat/*/STATUS - message`);

                return;
            }
        }

        const subTopics = this.getSubTopics(baseTopic, topic);
        const nodeId = subTopics[1];
        const node = this.addNodeIfNecessary(initializedDevice, nodeId, message);
        // this.updateState(initializedDevice, node, message);
    }

    private isSkipTopic(topic: string): boolean {
        return topic.includes('STATUS') && !topic.endsWith('STATUS') || topic.endsWith('RESULT');
    }

    private getDevice(baseTopic: string, topic: string): DeviceWithNode {
        const base = baseTopic.replace('#', '');
        const remainingTopicParts = topic.replace(base, '')
            .split('/');

        return {
            deviceName: remainingTopicParts[0],
            sourceTopic: base + remainingTopicParts[0],
            deviceTopic: `${this.baseHomieTopic}/${remainingTopicParts[0]}`
        };

    }

    // private updateState(homieDevice: HomieDevice, node: DeviceNode, message: string): void {
    //     myLogger.debug('Updating State');
    //     homieDevice.stats.lastSeen = new Date();
    //     const nodeNameWithProperties = this.disassembleMessage(message);
    //     node.properties.forEach(property => {
    //         const value = !!jsonObj ? jsonObj[property.name] : message;
    //         if (value !== undefined) {
    //             homieDevice.messagesToSend.next({topic: `${property.propertyTopic}`, message: value});
    //         }
    //     });
    // }

    private addDevice(deviceName: string, message: string): HomieDevice {
        const subj = new ReplaySubject<MqttMessage>(1000, 5000);
        const jsonMessage = JSON.parse(message);
        const friendlyName = jsonMessage?.Status?.FriendlyName[0];

        const stats: HomieStats = {
            firstSeen: new Date(),
            interval: 120,
            battery: 100,
            voltage: 0,
            lastSeen: new Date(),
            signal: 0,
            uptime: 0
        };
        const homieDevice: HomieDevice = {
            id: deviceName,
            name: friendlyName ?? deviceName,
            nodes: [],
            messagesToSend: subj,
            stats: stats,
            state: 'init',
            deviceTopic: `${this.baseHomieTopic}/${deviceName}`,
            requiredNodes: ['STATUS', 'POWER']
        };

        const client = mqtt.connect(this.homieMqttConfig.brokerUrl, {
            clientId: `General Purpose Mqtt To Homie writer for ${deviceName}`,
            keepalive: 60,
            password: this.homieMqttConfig.password,
            username: this.homieMqttConfig.username,
            will: {topic: `${this.baseHomieTopic}/${deviceName}/$state`, payload: 'lost', qos: 1, retain: true}
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

            client.subscribe(`${homieDevice.deviceTopic}/#`, (error: any) => {
                myLogger.info('Subscription success');
                if (error) {
                    myLogger.error(`Error: ${error}`);
                }
            });

            client.on('message', (topic: string, homieMsg: string) => {
                this.handleHomieMessage(topic, homieMsg.toString());
            });
        });

        this.initHomieMqtt(homieDevice);

        return this.devices[deviceName] = homieDevice;
    }

    private updateNodes(homieDevice: HomieDevice): void {

        let stateChangeNeeded = homieDevice.state !== 'init';

        if (stateChangeNeeded) {
            homieDevice.messagesToSend.next({topic: `${homieDevice.deviceTopic}/$state`, message: 'init'});
        }

        if (homieDevice.requiredNodes.every(required => homieDevice.nodes.some(node => node.nodeId === required))) {
            myLogger.info(`All required nodes are available Device ${homieDevice.name} will become ready`);
            stateChangeNeeded = true;
        }

        homieDevice.nodes.forEach(node => {
            const homieNodeTopic = node.nodeTopic;
            const properties = node.properties;
            homieDevice.messagesToSend.next({topic: `${homieNodeTopic}/$name`, message: node.nodeName});
            homieDevice.messagesToSend.next({topic: `${homieNodeTopic}/$type`, message: 'nodeType'});
            homieDevice.messagesToSend.next({
                topic: `${homieNodeTopic}/$properties`,
                message: properties
                    .map(p => p.name)
                    .join(',')
            });

            properties.forEach((property: MessageProperty) => {
                const propertyTopic = property.propertyTopic;
                homieDevice.messagesToSend.next({topic: `${propertyTopic}/$name`, message: property.name});
                homieDevice.messagesToSend.next({topic: `${propertyTopic}/$datatype`, message: property.type});
                if (property.format) {
                    homieDevice.messagesToSend.next({topic: `${propertyTopic}/$format`, message: property.format});
                }
                if (property.settable) {
                    homieDevice.messagesToSend.next({topic: `${propertyTopic}/$settable`, message: 'true'});
                }
            });
        });

        const nodeNames = homieDevice.nodes
            .map(node => node.nodeId)
            .join(',');
        homieDevice.messagesToSend.next({topic: `${homieDevice.deviceTopic}/$nodes`, message: nodeNames});

        if (stateChangeNeeded) {
            homieDevice.messagesToSend.next({topic: `${homieDevice.deviceTopic}/$state`, message: 'ready'});
        }
    }

    private initHomieMqtt(homieDevice: HomieDevice): void {
        const subj = homieDevice.messagesToSend;
        const deviceTopic = homieDevice.deviceTopic;
        const stats = homieDevice.stats;
        subj.next({topic: `${deviceTopic}/$homie`, message: '3.0'});
        subj.next({topic: `${deviceTopic}/$name`, message: homieDevice.name});
        subj.next({topic: `${deviceTopic}/$state`, message: 'init'});

        timer(0, stats.interval * 1000)
            .subscribe(() => {
                myLogger.silly(`Updating Stats for ${homieDevice.name}`);
                const uptime = Math.floor((new Date().getTime() - stats.firstSeen.getTime()) / 1000);

                const statsTopic = `${deviceTopic}/$stats`;
                subj.next({topic: `${statsTopic}`, message: 'uptime,signal,battery,voltage,firstSeen,lastSeen'});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/interval`, message: stats.interval.toString(10)});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/uptime`, message: uptime.toString(10)});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/signal`, message: stats.signal.toString(10)});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/voltage`, message: stats.voltage.toString(10)});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/battery`, message: stats.battery.toString(10)});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/firstSeen`, message: stats.firstSeen.toISOString()});
                subj.next({logLevel: 'silly', topic: `${statsTopic}/lastSeen`, message: stats.lastSeen.toISOString()});

                const lastSeenHours = (new Date().getTime() - stats.lastSeen.getTime()) / 1000 / 60 / 60;
                if (lastSeenHours > 6) {
                    subj.next({topic: `${deviceTopic}/$state`, message: 'lost'});
                }
            });
    }

    private addNodeIfNecessary(homieDevice: HomieDevice, nodeId: string, message: string): DeviceNode {
        const nodeNameWithProperties = this.disassembleMessage(message, nodeId);
        homieDevice.stats.lastSeen = new Date();
        let node = homieDevice.nodes.find(n => n.nodeId === nodeId);
        let newNode = false;
        if (!node) {
            myLogger.debug(`Adding previously unknown node ${nodeId} for device ${homieDevice.id}`);
            newNode = true;
            node = {
                nodeId: nodeId,
                nodeTopic: `${homieDevice.deviceTopic}/${nodeId}`,
                device: homieDevice,
                nodeName: nodeNameWithProperties.name ?? nodeId,
                properties: []
            };
        }

        node.properties = nodeNameWithProperties.properties
            .map(p => ({
                ...p,
                propertyTopic: `${node.nodeTopic}/${p.name}`,
                commandTopic: p.settable ? `cmnd/${homieDevice.id}/${node.nodeId}` : undefined
            }));

        node.properties.forEach(property => {
            homieDevice.messagesToSend.next({topic: `${property.propertyTopic}`, message: property.value, logLevel: 'silly'});
        });

        if (newNode) {
            homieDevice.nodes.push(node);
            this.updateNodes(homieDevice);
        }

        return node;
    }

    private disassembleMessage(msg: string, nodeName?: string): NodeNameWithProperties {
        const message = msg.toString();
        myLogger.silly(`Disassemble message ${message}`);
        if (!message.startsWith('{') || !message.endsWith('}')) {
            let name = 'value';
            let type = 'string';
            let value: any = message;
            let settable: boolean;
            let format: string;

            if (nodeName === 'POWER') {
                name = 'powerSwitch';
                type = 'boolean';
                // format = 'ON,OFF,TOGGLE';
                settable = true;
                value = message === 'ON';
            }

            return {properties: [{name, type, format, settable, value}]};
        }
        let jsonMessage = JSON.parse(message);
        const properties = new Array<MessageProperty>();
        const msgKeys = Object.keys(jsonMessage);
        let name;
        if (msgKeys.length === 1) {
            name = msgKeys[0];
            jsonMessage = jsonMessage[msgKeys[0]];
        }
        this.flattenObject('', jsonMessage, properties);

        myLogger.silly(`Disassembled message ${message} contains ${properties.length} properties`);

        return {name: name, properties: properties};
    }

    private flattenObject(prefix: string, value: any, properties: Array<MessageProperty>): void {
        Object.keys(value)
            .forEach(key => {
                let valueVal = value[key];
                const valueKey = prefix ? `${prefix}${key}` : key;
                if (typeof valueVal === 'object' && !Array.isArray(valueVal)) {
                    this.flattenObject(valueKey, valueVal, properties);
                } else {
                    if (Array.isArray(valueVal)) {
                        valueVal = valueVal.join(', ');
                    }
                    properties.push(
                        {
                            name: valueKey,
                            type: TasmotaConvertToHomieService.guessType(valueVal),
                            value: valueVal
                        }
                    );
                }
            });
    }

    private getDeviceName(baseTopic: string, topic: string): string {
        const remainingTopicParts = this.getSubTopics(baseTopic, topic);

        return remainingTopicParts[0];
    }

    private getSubTopics(baseTopic: string, topic: string): Array<string> {
        const base = baseTopic.replace('#', '');

        return topic.replace(base, '')
            .split('/');
    }

    private handleHomieMessage(topic: string, homieMsg: string): void {
        if (!topic.endsWith('set') || homieMsg === '') {
            return;
        }
        myLogger.debug(`homie set message received ${topic}, ${homieMsg}`);
        const propertyTopic = topic.replace(/\/set/, '');
        const subtopics = this.getSubTopics('homie/#', topic);
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
            this.senderClient.publish(property.commandTopic, msg);
            device.messagesToSend.next({topic, message: '', logLevel: 'silly'});
        }
    }
}
