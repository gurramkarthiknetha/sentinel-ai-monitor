import mongoose from "mongoose";

const incidentLocationSchema = new mongoose.Schema(
  {
    lat: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },
    lng: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },
  },
  { _id: false },
);

const incidentSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["fire", "crowd", "medical", "security", "inactivity"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "assigned", "in_progress", "pending_confirmation", "escalated", "resolved"],
      default: "active",
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    zone: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: incidentLocationSchema,
      required: true,
    },
    sourceCameraId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Camera",
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    assignedTo: {
      type: String,
      trim: true,
    },
    assignedResponderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    assignedAt: {
      type: Date,
    },
    acceptedAt: {
      type: Date,
    },
    resolvedByResponderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    responderValidation: {
      type: String,
      enum: ["pending", "valid_incident", "false_alert"],
      default: "pending",
    },
    aiDecision: {
      type: String,
      enum: ["needs_human_validation", "auto_resolved", "auto_escalated"],
      default: "needs_human_validation",
    },
    detectionMethod: {
      type: String,
      enum: ["YOLO", "POSE", "CNN", "HYBRID"],
      default: "YOLO",
    },
    predictionDetails: {
      type: String,
      trim: true,
    },
    snapshotUrl: {
      type: String,
      trim: true,
    },
    snapshotBase64: {
      type: String,
      trim: true,
    },
    notes: {
      type: [String],
      default: [],
    },
    confirmationDeadline: {
      type: Date,
    },
    escalatedAt: {
      type: Date,
    },
    resolvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

incidentSchema.index({ timestamp: -1 });
incidentSchema.index({ status: 1, severity: 1 });
incidentSchema.index({ type: 1, status: 1, timestamp: -1 });
incidentSchema.index({ assignedResponderId: 1, status: 1, timestamp: -1 });
incidentSchema.index({ sourceCameraId: 1, type: 1, status: 1, timestamp: -1 });

export default mongoose.model("Incident", incidentSchema);