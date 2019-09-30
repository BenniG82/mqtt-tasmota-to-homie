import { HomieDevices, HomieProperties, Settings } from './interfaces';

export const environment: Settings = {
    mqtt: {
        brokerUrl: 'mqtt://10.8.0.62',
        clientId: 'TBD',
        username: 'mqtt',
        password: 'password',
        deviceTopicOneWire: 'homie/onewire2/'
    },
    baseTasmotaTopic: 'tele/sonoff/#',
    baseHomieTopic: 'homie'

};

const SP111_PROPERTIES: HomieProperties = {
    voltage: {
        $name: 'Spannung',
        $settable: false,
        $unit: 'V',
        $datatype: 'integer',
        $$value: '%SENSOR.ENERGY.Voltage%'
    },
    power: {
        $name: 'Leistung',
        $settable: false,
        $unit: 'W',
        $datatype: 'integer',
        $$value: '%SENSOR.ENERGY.Power%'
    }
};

export const SONOFF_MAPPING: HomieDevices = {
    waschmaschine: {
        $homie: '3.0',
        $name: 'Waschmaschine',
        $$homieTopic: 'homie/waschmaschine',
        $$sourceTopic: 'tele/sonoff/wama',
        $$nodes: {
            SP111: {
                ...SP111_PROPERTIES,
                powerState: {
                    $name: 'Ein/Aus',
                    $settable: true,
                    $datatype: 'enum',
                    $format: 'ON,OFF,TOGGLE',
                    $$value: '%STATE.POWER%',
                    $$command: 'cmnd/sonoff/wama/POWER'
                }
            }
        }
    },
    geschirr: {
        $homie: '3.0',
        $name: 'Geschirrspüler',
        $$homieTopic: 'homie/geschirr',
        $$sourceTopic: 'tele/sonoff/geschirr',
        $$nodes: {
            SP111: {
                ...SP111_PROPERTIES,
                powerState: {
                    $name: 'Ein/Aus',
                    $settable: true,
                    $datatype: 'enum',
                    $format: 'ON,OFF,TOGGLE',
                    $$value: '%STATE.POWER%',
                    $$command: 'cmnd/sonoff/geschirr/POWER'
                }
            }
        }
    },
    luftentfeuchter: {
        $homie: '3.0',
        $name: 'Luftentfeuchter',
        $$homieTopic: 'homie/luftentfeuchter',
        $$sourceTopic: 'tele/sonoff/luftentfeuchter',
        $$nodes: {
            SP111: {
                ...SP111_PROPERTIES,
                powerState: {
                    $name: 'Ein/Aus',
                    $settable: true,
                    $datatype: 'enum',
                    $format: 'ON,OFF,TOGGLE',
                    $$value: '%STATE.POWER%',
                    $$command: 'cmnd/sonoff/luftentfeuchter/POWER'
                }
            }
        }
    }
};