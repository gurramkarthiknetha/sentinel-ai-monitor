import mongoose from "mongoose";

const cameraSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: ["RTSP", "SYSTEM"],
      default: "RTSP",
    },
    rtspUrl: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    deviceId: {
      type: String,
      trim: true,
    },
    deviceIndex: {
      type: Number,
      min: 0,
    },
    location: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["ONLINE", "OFFLINE"],
      default: "OFFLINE",
    },
    lastActive: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Camera", cameraSchema);
