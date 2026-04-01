import mongoose from "mongoose";

export const connectDB = async (mongoUri) => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");
};
