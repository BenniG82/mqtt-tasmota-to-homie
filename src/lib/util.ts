import { MqttMessage } from './interfaces';

export const msg = (topic: string, message: string): MqttMessage =>
    ({topic, message});
