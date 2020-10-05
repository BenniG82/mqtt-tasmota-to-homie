import { MqttClient } from 'mqtt';

export interface TasmotaMqttConfig {
    mqtt: MqttServerConfig;
    baseTasmotaTopic: string;
}

export interface MqttServerConfig {
    brokerUrl: string;
    username: string;
    password: string;
}

export interface SourceMqttServerConfig extends MqttServerConfig {
    baseTopics: Array<string>;
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

export interface OnMessageHandler {
    senderClient: MqttClient;
    onMessage(baseTopic: string, topic: string, message: string): void;
}
