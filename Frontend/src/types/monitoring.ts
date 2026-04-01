export type CameraStatus = "ONLINE" | "OFFLINE";
export type CameraSourceType = "RTSP" | "SYSTEM";

export interface CameraEntity {
  _id: string;
  name: string;
  sourceType?: CameraSourceType;
  rtspUrl: string;
  deviceId?: string;
  location?: string;
  status: CameraStatus;
  lastActive?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DetectionBox {
  class: number;
  confidence: number;
  bbox: [number, number, number, number];
  bboxFormat?: "xywh" | "xyxy";
}

export interface DetectionUpdateEvent {
  cameraId: string;
  detections: DetectionBox[];
  timestamp: string;
}

export interface CameraStatusEvent {
  cameraId: string;
  status: CameraStatus;
  lastActive?: string;
  timestamp: string;
}

export interface CameraDeletedEvent {
  cameraId: string;
  timestamp: string;
}

export interface CreateCameraInput {
  name: string;
  sourceType?: CameraSourceType;
  rtspUrl?: string;
  deviceId?: string;
  location?: string;
}
