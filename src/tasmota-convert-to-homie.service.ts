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
    client: mqtt.MqttClient;
    initializedNodes: Array<string>;
    messagesToSend: Subject<MqttMessage>;
    stats: HomieStats;
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
    nodeName: string;
    nodeTopic: string;
    device: DeviceWithNode;
}

interface NodeNameWithProperties {
    name?: string;
    properties: Array<MessageProperty>;
}

export class TasmotaConvertToHomieService implements OnMessageHandler {

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

    private static getNode(device: DeviceWithNode, topic: string, message: string): DeviceNode {
        return {
            nodeName: topic.replace(/\//, ''),
            nodeTopic: `${device.deviceTopic}/${topic}`,
            device: device
        };
    }

    constructor(private readonly homieMqttConfig: MqttServerConfig) {
    }

    onMessage(baseTopic: string, topic: string, message: string): void {
        if (!topic.includes('dg-02')) {
            return;
        }
        if (topic.includes('STATUS') && !topic.endsWith('STATUS') || topic.endsWith('RESULT')) {
            return;
        }
        const base = baseTopic.replace('#', '');
        const device = this.getDevice(baseTopic, topic);
        const remainingTopic = topic.replace(`${device.sourceTopic}/`, '');
        const node = TasmotaConvertToHomieService.getNode(device, remainingTopic, message);

        myLogger.debug(`message received ${baseTopic} ${topic}, ${message} device ${device.deviceName} node ${node.nodeName}`);

        let initializedDevice: HomieDevice;
        initializedDevice = this.devices[device.deviceName];
        if (!initializedDevice) {
            if (topic.startsWith('stat/') && topic.endsWith('STATUS')) {
                initializedDevice = this.addDevice(device, message);
            } else {
                myLogger.debug(`Could not add device ${device.deviceName}, waiting for a stat/*/STATUS - message`);

                return;
            }
        }
        this.addNodeIfNecessary(initializedDevice, device, node, message);
        this.updateState(initializedDevice, device, node, message);
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

    private updateState(homieDevice: HomieDevice, device: DeviceWithNode, node: DeviceNode, message: string): void {
        myLogger.debug('Updating State');
        homieDevice.stats.lastSeen = new Date();
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        const nodeTopic = node.nodeTopic;
        this.disassembleMessage(message).properties
            .forEach((property: MessageProperty) => {
                TasmotaConvertToHomieService.updateStats(homieDevice, property);
                const propertyTopic = `${nodeTopic}/${property.name}`;
                homieDevice.messagesToSend.next({topic: `${propertyTopic}`, message: property.value});
            });
    }

    private addDevice(device: DeviceWithNode, message: string): HomieDevice {
        const subj = new ReplaySubject<MqttMessage>(1000, 5000);
        const client = mqtt.connect(this.homieMqttConfig.brokerUrl, {
            clientId: `General Purpose Mqtt To Homie writer for ${device.deviceName}`,
            keepalive: 60,
            password: this.homieMqttConfig.password,
            username: this.homieMqttConfig.username,
            will: {topic: `${this.baseHomieTopic}/${device.deviceName}/$state`, payload: 'lost', qos: 1, retain: true}
        });
        client.on('connect', () => {
            myLogger.info(`Connected for device ${device.deviceName}`);
            subj.subscribe(msg => {
                if (msg.logLevel === 'silly') {
                    myLogger.silly(`Sending to ${msg.topic}: ${msg.message} for ${device.deviceName}`);
                } else {
                    myLogger.info(`Sending to ${msg.topic}: ${msg.message} for ${device.deviceName}`);
                }
                const opts: mqtt.IClientPublishOptions = {retain: true, qos: 1};
                client.publish(msg.topic, msg.message.toString(), opts, (error => {
                    if (error) {
                        myLogger.error(`An error has occurred while sending a message to topic ${msg.topic}: ${error}`);
                    }
                }));
            });
        });
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        const stats: HomieStats = {
            firstSeen: new Date(),
            interval: 120,
            battery: 100,
            voltage: 0,
            lastSeen: new Date(),
            signal: 0,
            uptime: 0
        };
        const jsonMessage = JSON.parse(message);
        subj.next({topic: `${deviceTopic}/$name`, message: jsonMessage.Status.FriendlyName[0]});
        subj.next({topic: `${deviceTopic}/$state`, message: 'init'});
        subj.next({topic: `${deviceTopic}/$nodes`, message: ''});
        subj.next({topic: `${deviceTopic}/$homie`, message: '3.0'});

        timer(0, stats.interval * 1000)
            .subscribe(() => {
                myLogger.silly(`Updating Stats for ${device.deviceName}`);
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

        return this.devices[device.deviceName] = {
            client: client,
            initializedNodes: [],
            messagesToSend: subj,
            stats: stats
        };
    }

    private addNodeIfNecessary(homieDevice: HomieDevice, device: DeviceWithNode, node: DeviceNode, message: string): void {
        if (homieDevice.initializedNodes.includes(node.nodeName)) {
            return;
        }
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        if (!homieDevice.initializedNodes.includes(node.nodeName)) {
            homieDevice.initializedNodes.push(node.nodeName);
            myLogger.debug(`Adding previously unknown node ${node.nodeTopic} for device ${device.deviceName}`);
            homieDevice.messagesToSend.next({topic: `${deviceTopic}/$state`, message: 'init'});
            homieDevice.messagesToSend
                .next({topic: `${deviceTopic}/$nodes`, message: homieDevice.initializedNodes.join(',')});
        }

        const nodeNameWithProperties = this.disassembleMessage(message, node.nodeName);
        const properties = nodeNameWithProperties.properties;
        const nodeTopic = node.nodeTopic;
        const nodeName = nodeNameWithProperties.name || node.nodeName;
        homieDevice.messagesToSend.next({topic: `${nodeTopic}/$name`, message: nodeName});
        homieDevice.messagesToSend.next({topic: `${nodeTopic}/$type`, message: 'nodeType'});
        homieDevice.messagesToSend.next({
            topic: `${nodeTopic}/$properties`,
            message: properties
                .map(p => p.name)
                .join(',')
        });

        properties.forEach((property: MessageProperty) => {
            const propertyTopic = `${nodeTopic}/${property.name}`;
            homieDevice.messagesToSend.next({topic: `${propertyTopic}/$name`, message: property.name});
            homieDevice.messagesToSend.next({topic: `${propertyTopic}/$datatype`, message: property.type});
            if (property.format) {
                homieDevice.messagesToSend.next({topic: `${propertyTopic}/$format`, message: property.format});
            }
            if (property.settable) {
                homieDevice.messagesToSend.next({topic: `${propertyTopic}/$settable`, message: 'true'});
            }
        });

        homieDevice.messagesToSend.next({topic: `${deviceTopic}/$state`, message: 'ready'});
    }

    private disassembleMessage(msg: string, nodeName?: string): NodeNameWithProperties {
        const message = msg.toString();
        myLogger.debug(`Disassemble message ${message}`);
        if (!message.startsWith('{') || !message.endsWith('}')) {
            let name = 'value';
            let type = 'string';
            let settable: boolean;
            let format: string;

            if (nodeName === 'POWER') {
                name = 'power_switch';
                type = 'enum';
                format = 'ON,OFF,TOGGLE';
                settable = true;
            }

            return {properties: [{name, type, format, settable, value: message}]};
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
        // Object.keys(jsonMessage)
        //     .forEach((property: string) => {
        //         const value = jsonMessage[property];
        //         if (typeof value === 'object') {
        //             this.flattenObject(property, value, properties);
        //         } else {
        //             properties.push(
        //                 {
        //                     name: property,
        //                     type: TasmotaConvertToHomieService.guessType(value),
        //                     value
        //                 }
        //             );
        //         }
        //     });
        myLogger.debug(`Disassembled message ${message} contains ${properties.length} properties`);

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
}
