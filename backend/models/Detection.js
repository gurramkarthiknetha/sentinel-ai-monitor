import mongoose from "mongoose";

const detectionSchema = new mongoose.Schema(
  {
    cameraId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Camera",
      required: true,
    },
    detections: [
      {
        class: {
          type: Number,
          required: true,
        },
        confidence: {
          type: Number,
          required: true,
        },
        bbox: {
          type: [Number],
          required: true,
          validate: {
            validator: (bbox) => Array.isArray(bbox) && bbox.length === 4,
            message: "bbox must contain exactly 4 numbers: [x, y, width, height]",
          },
        },
      },
    ],
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

detectionSchema.index({ cameraId: 1, timestamp: -1 });

export default mongoose.model("Detection", detectionSchema);
