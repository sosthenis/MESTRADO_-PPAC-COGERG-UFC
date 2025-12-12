export interface AudioConfig {
  sampleRate: number;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

export interface MessageLog {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
}

export interface VolumeLevel {
  input: number;
  output: number;
}