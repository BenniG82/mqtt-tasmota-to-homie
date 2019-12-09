import { myLogger } from './logger';
import * as mqtt from 'mqtt';
import { IClientPublishOptions } from 'mqtt';
import { MqttServerConfig } from './interfaces';
import { ReplaySubject, Subject } from 'rxjs';

interface MessageProperty {
    name: string;
    type: string;
    value: any;
}

interface MqttMessage {
    message: string;
    topic: string;
}

interface HomieDevice {
    client: mqtt.MqttClient;
    initializedNodes: Array<string>;
    messagesToSend: Subject<MqttMessage>;
}

interface DeviceMap {
    [key: string]: HomieDevice;
}

interface DeviceWithNode {
    deviceName: string;
    node: string;
}

export class SimpleConvertToHomieService {

    private devices: DeviceMap = {};
    private baseHomieTopic = 'homie';

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

    constructor(private homieMqttConfig: MqttServerConfig) {
    }

    onMessage(baseTopic: string, topic: string, message: string): void {
        const device = this.getDevice(baseTopic, topic);
        myLogger.debug(`message received ${baseTopic} ${topic}, ${message} device ${device}`);

        let initializedDevice: HomieDevice;
        initializedDevice = this.devices[device.deviceName] ? this.devices[device.deviceName] : this.addDevice(device, message);
        this.addNodeIfNecessary(initializedDevice, device, message);
        this.updateState(initializedDevice, device, message);
    }

    private getDevice(baseTopic: string, topic: string): DeviceWithNode {
        const base = baseTopic.replace('#', '');
        const remainingTopicParts = topic.replace(base, '')
            .split('/');

        return {
            deviceName: remainingTopicParts[0],
            node: remainingTopicParts.length > 1 ? remainingTopicParts[1] : 'requiredNode'
        };

    }

    private updateState(homieDevice: HomieDevice, device: DeviceWithNode, message: string): void {
        myLogger.debug('Updating State');
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        const nodeTopic = `${deviceTopic}/${device.node}`;
        this.disassembleMessage(message)
            .forEach((property: MessageProperty) => {
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
                myLogger.info(`Sending to ${msg.topic}: ${msg.message}`);
                client.publish(msg.topic, msg.message.toString(), {retain: true} as IClientPublishOptions);
            });
        });
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        subj.next({topic: `${deviceTopic}/$homie`, message: '3.0'});
        subj.next({topic: `${deviceTopic}/$name`, message: device.deviceName});
        subj.next({topic: `${deviceTopic}/$state`, message: 'init'});
        subj.next({topic: `${deviceTopic}/$nodes`, message: ''});

        return this.devices[device.deviceName] = {client, initializedNodes: [], messagesToSend: subj};
    }

    private addNodeIfNecessary(homieDevice: HomieDevice, device: DeviceWithNode, message: string): void {
        if (homieDevice.initializedNodes.indexOf(device.node) >= 0) {
            return;
        }
        const deviceTopic = `${this.baseHomieTopic}/${device.deviceName}`;
        homieDevice.initializedNodes.push(device.node);
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

        return properties;
    }
}
