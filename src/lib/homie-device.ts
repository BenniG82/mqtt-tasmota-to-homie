import { Subject, timer } from 'rxjs';
import * as mqtt from 'mqtt';
import { DeviceNode, HomieDeviceProperties, HomieStats, MqttMessage, NodeProperty } from './interfaces';
import { myLogger } from '../logger';

export class HomieDevice implements HomieDeviceProperties {
    messagesToSend: Subject<MqttMessage>;
    requiredNodes: Array<string>;
    stats: HomieStats;
    nodes: Array<DeviceNode>;
    id: string;
    name: string;
    deviceTopic: string;
    currentState: HomieDeviceProperties['currentState'] = 'init';
    mqttClient: mqtt.MqttClient;
    ready = false;

    constructor(properties: HomieDeviceProperties) {
        Object.assign(this, properties);
    }

    changeDeviceState(desiredState: HomieDeviceProperties['currentState']): void {
        this.messagesToSend.next({topic: `${this.deviceTopic}/$state`, message: desiredState});
        this.currentState = desiredState;
    }

    updateNodes(): void {
        if (this.currentState !== 'init') {
            // When changing metadata, we need to go back to init
            this.changeDeviceState('init');
        }

        this.nodes.forEach(node => {
            const homieNodeTopic = node.nodeTopic;
            const additionalProperties = (node.customProperties ?? [])
                .filter(cust => !node.properties.find(prop => prop.name === cust.name));

            const properties = [...node.properties, ...additionalProperties];
            this.messagesToSend.next({topic: `${homieNodeTopic}/$name`, message: node.nodeName});
            this.messagesToSend.next({topic: `${homieNodeTopic}/$type`, message: 'nodeType'});
            this.messagesToSend.next({
                topic: `${homieNodeTopic}/$properties`,
                message: properties
                    .map(p => p.name)
                    .join(',')
            });

            properties.forEach((property: NodeProperty) => {
                const propertyTopic = property.propertyTopic;
                this.messagesToSend.next({topic: `${propertyTopic}/$name`, message: property.name});
                this.messagesToSend.next({topic: `${propertyTopic}/$datatype`, message: property.type});
                if (property.format) {
                    this.messagesToSend.next({topic: `${propertyTopic}/$format`, message: property.format});
                }
                if (property.settable) {
                    this.messagesToSend.next({topic: `${propertyTopic}/$settable`, message: 'true'});
                    if (!property.homieSubscription) {
                        this.mqttClient.subscribe(`${property.propertyTopic}/set`, error => {
                            if (error) {
                                myLogger.warn(`Could not subscribe to topic ${property.propertyTopic}/set`, error);
                            } else {
                                property.homieSubscription = true;
                            }
                        });
                    }
                }
            });
        });

        const nodeNames = this.nodes
            .map(node => node.nodeId)
            .join(',');
        this.messagesToSend.next({topic: `${this.deviceTopic}/$nodes`, message: nodeNames});

        const requiredNodesAvailable = this.requiredNodes.length === 0 || this.requiredNodes
            .every(required => this.nodes.some(node => node.nodeId.startsWith(required)));

        if (this.currentState !== 'ready' && requiredNodesAvailable) {
            // There seems to be a bug in the Openhab Homie implementation
            // if a device becomes ready too fast after a config change
            setTimeout(() => this.changeDeviceState('ready'), 5000);
            if (!this.ready) {
                this.ready = true;
                myLogger.info(`Device ${this.id} will become ready in 5 seconds`);
            }
        }
    }

    updateLastSeen(): void {
        this.stats.lastSeen = new Date();
    }

    sendNodePropertyValues(node: DeviceNode): void {
        const homieDevice = node.device;
        homieDevice.updateLastSeen();
        node.properties.forEach(property => {
            this.updateStats(property);
            homieDevice.messagesToSend.next({
                topic: `${property.propertyTopic}`,
                message: property.value,
                noRetain: property.noRetain
            });
        });
    }

    getNodeById(nodeId: string): DeviceNode {
        return this.nodes.find(n => n.nodeId === nodeId);
    }

    findOrAddNode(nodeId: string,
                  friendlyName: string,
                  applyProperties: (node: DeviceNode) => Array<NodeProperty>,
                  applyCustomProperties?: (node: DeviceNode) => Array<NodeProperty>): DeviceNode {
        let node = this.getNodeById(nodeId);
        if (!node) {
            node = {
                nodeId: nodeId,
                nodeTopic: `${this.deviceTopic}/${nodeId}`,
                device: this,
                nodeName: friendlyName ?? nodeId,
                homeInitialized: false
            };
            this.nodes.push(node);
        }
        if (applyProperties) {
            node.properties = applyProperties(node);
        }
        if (applyCustomProperties) {
            node.customProperties = applyCustomProperties(node);
        }
        if (!node.homeInitialized && node.properties && node.properties.length > 0) {
            node.homeInitialized = true;
            this.sendNodePropertyValues(node);
            this.updateNodes();
        }

        return node;
    }

    init(): void {
        const subj = this.messagesToSend;
        const deviceTopic = this.deviceTopic;
        const stats = this.stats;
        this.currentState = 'init';
        this.sendHomieDeviceInfo();

        timer(0, stats.interval * 1000)
            .subscribe(() => {
                myLogger.silly(`Updating Stats for ${this.id}`);
                const uptime = Math.floor((new Date().getTime() - stats.firstSeen.getTime()) / 1000);

                const statsTopic = `${deviceTopic}/$stats`;
                subj.next({topic: `${statsTopic}`, message: 'uptime,signal,battery,voltage,firstSeen,lastSeen'});
                subj.next({topic: `${statsTopic}/interval`, message: stats.interval.toString(10)});
                subj.next({topic: `${statsTopic}/uptime`, message: uptime.toString(10)});
                subj.next({topic: `${statsTopic}/signal`, message: stats.signal.toString(10)});
                subj.next({topic: `${statsTopic}/voltage`, message: stats.voltage.toString(10)});
                subj.next({topic: `${statsTopic}/battery`, message: stats.battery.toString(10)});
                subj.next({topic: `${statsTopic}/firstSeen`, message: stats.firstSeen.toISOString()});
                subj.next({topic: `${statsTopic}/lastSeen`, message: stats.lastSeen.toISOString()});

                const lastSeenHours = (new Date().getTime() - stats.lastSeen.getTime()) / 1000 / 60 / 60;
                if (lastSeenHours > 6) {
                    subj.next({topic: `${deviceTopic}/$state`, message: 'lost'});
                }
            });
        myLogger.info(`Initializing device ${this.id}`);
    }

    resendHomieStructure(): void {
        this.changeDeviceState('init');
        this.sendHomieDeviceInfo();
        this.updateNodes();
        this.changeDeviceState('ready');
    }

    private sendHomieDeviceInfo(): void {
        const subj = this.messagesToSend;
        const deviceTopic = this.deviceTopic;
        subj.next({topic: `${deviceTopic}/$homie`, message: '3.0'});
        subj.next({topic: `${deviceTopic}/$name`, message: this.name});
        subj.next({topic: `${deviceTopic}/$state`, message: this.currentState});
    }

    private updateStats(property: NodeProperty): void {
        if (property.name === 'battery') {
            this.stats.battery = property.value;
        } else if (property.name === 'linkquality') {
            this.stats.signal = property.value;
        } else if (property.name === 'voltage') {
            this.stats.voltage = property.value;
        }
    }
}
