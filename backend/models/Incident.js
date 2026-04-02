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
      enum: ["active", "assigned", "in_progress", "resolved"],
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
    description: {
      type: String,
      required: true,
      trim: true,
    },
    assignedTo: {
      type: String,
      trim: true,
    },
    notes: {
      type: [String],
      default: [],
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

export default mongoose.model("Incident", incidentSchema);