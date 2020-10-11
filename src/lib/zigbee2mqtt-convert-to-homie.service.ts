import { MqttConvertToHomieService, SINGLE_NODE_NAME } from './mqtt-convert-to-homie-service';

interface Zigbee2MqttDeviceInfo {
    ieeeAddr: string;
    type: string;
    networkAddress: number;
    friendly_name: string;
    softwareBuildID: string;
    dateCode: string;
    lastSeen: number;
    model?: string;
    vendor?: string;
    description?: string;
    manufacturerID?: string;
    manufacturerName?: string;
    powerSource?: string;
    modelID?: string;
}

export class Zigbee2mqttConvertToHomieService extends MqttConvertToHomieService {

    onMessage(baseTopic: string, topic: string, msg: string): void {
        if (topic.endsWith('bridge/config/devices')) {
            this.configureDevices(msg);
        }
        super.onMessage(baseTopic, topic, msg);
    }

    private configureDevices(msg: string): void {
        const devicesConfigurations: Array<Zigbee2MqttDeviceInfo> = JSON.parse(msg.toString());
        devicesConfigurations.forEach(device => {
            const homieDevice = super.getDevice(device.friendly_name) ?? super.createAndRegisterDeviceWithName(device.friendly_name);
            if (device.modelID === 'lumi.sensor_switch') {
                homieDevice.findOrAddNode(
                    SINGLE_NODE_NAME,
                    SINGLE_NODE_NAME,
                    node => [
                        {
                            name: 'battery',
                            type: 'float',
                            value: '',
                            propertyTopic: `${node.nodeTopic}/battery`
                        },
                        {
                            name: 'voltage',
                            type: 'float',
                            value: '',
                            propertyTopic: `${node.nodeTopic}/voltage`
                        },
                        {
                            name: 'linkquality',
                            type: 'float',
                            value: '',
                            propertyTopic: `${node.nodeTopic}/linkquality`
                        }
                    ]
                    ,
                    node => [
                        {
                            name: 'click',
                            type: 'string',
                            value: '',
                            noRetain: true,
                            propertyTopic: `${node.nodeTopic}/click`
                        },
                        {
                            name: 'action',
                            type: 'string',
                            value: '',
                            noRetain: true,
                            propertyTopic: `${node.nodeTopic}/action`
                        },
                        {
                            name: 'duration',
                            type: 'number',
                            value: '',
                            noRetain: true,
                            propertyTopic: `${node.nodeTopic}/duration`
                        }
                    ]);
            }
        });
    }
}
