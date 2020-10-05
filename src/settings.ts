import { HomieDevices, HomieNodes, MqttServerConfig, SourceMqttServerConfig, TasmotaMqttConfig } from './interfaces';

/**
 * Here we configure the mqtt server with the Tasmota topic layout
 */
export const tasmotaMqttConfig: TasmotaMqttConfig = {
    mqtt: {
        brokerUrl: 'mqtt://192.168.0.45',
        username: 'mqtt',
        password: 'password'
    },
    baseTasmotaTopic: 'tele/sonoff/#'
};

/**
 * Here we configure the mqtt server with the source topic layout for tasmota, may be the same as the Homie mqtt server
 */
export const sourceMqttConfigTasmota: SourceMqttServerConfig = {
    brokerUrl: 'mqtt://192.168.0.45',
    username: 'mqtt',
    password: 'password',
    baseTopics: ['tele/#', 'stat/#']
    // baseTopics: ['stat/#']
};

/**
 * Here we configure the mqtt server with the source topic layout, may be the same as the Homie mqtt server
 */
export const sourceMqttConfig: SourceMqttServerConfig = {
    brokerUrl: 'mqtt://192.168.0.45',
    username: 'mqtt',
    password: 'password',
    baseTopics: ['zigbee2mqtt/#']
};

/**
 * Here we configure the mqtt server with the Homie topic layout, may be the same as the Tasmota mqtt server
 */
export const homieMqttConfig: MqttServerConfig = {
    brokerUrl: 'mqtt://192.168.0.45',
    username: 'mqtt',
    password: 'password'
};

/**
 * Here we configure the homie properties we want to access. This is a mapping of Tasmotas STATE or SENSOR Topics.
 * You can access individual values from the state like this: '%SENSOR.ENERGY.Power%' or '%STATE.POWER%'.
 * This configuration here is specific for the kind of device. e.g. a BlitzWolf SHP power switch
 *
 * Feel free to add all properties you want. If you configured a device other than BlitzWolf SHP,
 * please share your configuration.
 */
const tasmotaNodeProperties: HomieNodes = {
    blitzWolfShp: {
        voltage: {
            $name: 'Voltage',
            $settable: false,
            $unit: 'V',
            $datatype: 'integer',
            $$value: '%SENSOR.ENERGY.Voltage%'
        },
        power: {
            $name: 'Power',
            $settable: false,
            $unit: 'W',
            $datatype: 'integer',
            $$value: '%SENSOR.ENERGY.Power%'
        },
        powerState: {
            $name: 'Powerstate',
            $settable: true,
            $datatype: 'enum',
            $format: 'ON,OFF,TOGGLE',
            $$value: '%STATE.POWER%',
            $$commandLeaf: 'POWER'
        }
    }
};

export const tasmotaMapping: HomieDevices = {
    waschmaschine: {
        $homie: '3.0',
        $name: 'Waschmaschine',
        $$homieTopic: 'homie/waschmaschine',
        $$sourceTopic: 'tele/sonoff/wama',
        $$commandTopic: 'cmnd/sonoff/wama',
        $$nodes: {
            ...tasmotaNodeProperties
        }
    },
    geschirr: {
        $homie: '3.0',
        $name: 'Geschirrspüler',
        $$homieTopic: 'homie/geschirr',
        $$sourceTopic: 'tele/sonoff/geschirr',
        $$commandTopic: 'cmnd/sonoff/geschirr',
        $$nodes: {
            ...tasmotaNodeProperties
        }
    },
    luftentfeuchter: {
        $homie: '3.0',
        $name: 'Luftentfeuchter',
        $$homieTopic: 'homie/luftentfeuchter',
        $$sourceTopic: 'tele/sonoff/luftentfeuchter',
        $$commandTopic: 'cmnd/sonoff/luftentfeuchter',
        $$nodes: {
            ...tasmotaNodeProperties
        }
    }
};
