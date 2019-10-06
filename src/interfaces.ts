export interface Settings {
    mqtt: {
        brokerUrl: string;
        clientId: string;
        username: string;
        password: string;
        deviceTopicOneWire: string;
    };
    baseTasmotaTopic: string;
    baseHomieTopic: string;
}

export interface HomieProperties {
    [key: string]: HomieProperty;
}

export interface HomieProperty {
    $name: string;
    $settable: boolean;
    $datatype: string;
    $unit?: string;
    $format?: string;
    $$value: string;
    $$commandLeaf?: string;
    $$lastKnown?: string;
}

export interface HomieNode {
    [key: string]: HomieProperty;
}

export interface HomieNodes {
    [key: string]: HomieNode;
}

export interface HomieDevice {
    $homie: string;
    $name: string;
    $$homieTopic: string;
    $$sourceTopic: string;
    $$commandTopic?: string;
    $$nodes: HomieNodes;
}

export interface HomieDevices {
    [key: string]: HomieDevice;
}
