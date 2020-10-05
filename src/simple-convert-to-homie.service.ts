import { myLogger } from './logger';
import * as mqtt from 'mqtt';
import { MqttServerConfig, OnMessageHandler } from './interfaces';
import { ReplaySubject, Subject, timer } from 'rxjs';
import { ConvertToHomieService } from './convert-to-homie.service';

interface MessageProperty {
    name: string;
    type: string;
    value: any;
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
    node: string;
}

export class SimpleConvertToHomieService implements OnMessageHandler {
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

    private static getDevice(baseTopic: string, topic: string): DeviceWithNode {
        const base = baseTopic.replace('#', '');
        const remainingTopicParts = topic.replace(base, '')
            .split('/');

        return {
            deviceName: remainingTopicParts[0],
            node: remainingTopicParts.length > 1 ? remainingTopicParts[1] : 'requiredNode'
        };

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

    constructor(private readonly homieMqttConfig: MqttServerConfig) {
    }

    onMessage(baseTopic: string, topic: string, message: string): void {
        const device = SimpleConvertToHomieService.getDevice(baseTopic, topic);
        myLogger.debug(`message received ${baseTopic} ${topic}, ${message} device ${device.deviceName}`);

        let initializedDevice: HomieDevice;
        initializedDevice = this.devices[device.deviceName] || this.addDevice(device);
        this.addNodeIfNecessary(initializedDevice, device, message);
        this.updateState(initializedDevice, device, message);
    }

    private updateState(homieDevice: HomieDevice, device: DeviceWithNode, message: string): void {
        myLogger.debug('Updating State');
        homieDevice.stats.lastSeen = new Date();
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        const nodeTopic = `${deviceTopic}/${device.node}`;
        this.disassembleMessage(message)
            .forEach((property: MessageProperty) => {
                SimpleConvertToHomieService.updateStats(homieDevice, property);
                const propertyTopic = `${nodeTopic}/${property.name}`;
                homieDevice.messagesToSend.next({topic: `${propertyTopic}`, message: property.value});
            });
    }

    private addDevice(device: DeviceWithNode): HomieDevice {
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

        subj.next({topic: `${deviceTopic}/$homie`, message: '3.0'});
        subj.next({topic: `${deviceTopic}/$name`, message: device.deviceName});
        subj.next({topic: `${deviceTopic}/$state`, message: 'init'});
        subj.next({topic: `${deviceTopic}/$nodes`, message: ''});

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

    private addNodeIfNecessary(homieDevice: HomieDevice, device: DeviceWithNode, message: string): void {
        // if (homieDevice.initializedNodes.indexOf(device.node) >= 0) {
        //     return;
        // }
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        if (!homieDevice.initializedNodes.includes(device.node)) {
            homieDevice.initializedNodes.push(device.node);
            myLogger.debug(`Adding previously unknown node ${device.node} for device ${device.deviceName}`);
        }
        homieDevice.messagesToSend
            .next({topic: `${deviceTopic}/$nodes`, message: homieDevice.initializedNodes.join(',')});

        const properties = this.disassembleMessage(message);
        const nodeTopic = `${deviceTopic}/${device.node}`;
        homieDevice.messagesToSend.next({topic: `${nodeTopic}/$name`, message: device.node});
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
        });

        homieDevice.messagesToSend.next({topic: `${deviceTopic}/$state`, message: 'ready'});
    }

    private disassembleMessage(msg: string): Array<MessageProperty> {
        const message = msg.toString();
        myLogger.debug(`Disassemble message ${message}`);
        if (!message.startsWith('{') || !message.endsWith('}')) {
            return [{name: 'value', type: 'string', value: message}];
        }
        const jsonMessage = JSON.parse(message);
        const properties = new Array<MessageProperty>();
        Object.keys(jsonMessage)
            .forEach((property: string) => {
                const value = jsonMessage[property];
                properties.push(
                    {
                        name: property,
                        type: SimpleConvertToHomieService.guessType(value),
                        value
                    }
                );
            });
        myLogger.debug(`Disassembled message ${message} contains ${properties.length} properties`);

        return properties;
    }
}
