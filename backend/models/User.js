import mongoose from "mongoose";
import { APPROVAL_STATUSES, RESPONDER_TYPES, USER_ROLES } from "../constants/auth.js";

const userSchema = new mongoose.Schema(
	{
		googleId: {
			type: String,
			required: true,
			unique: true,
			trim: true,
		},
		email: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
			trim: true,
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
		avatar: {
			type: String,
			trim: true,
		},
		role: {
			type: String,
			enum: USER_ROLES,
			default: "operator",
			required: true,
		},
		responderType: {
			type: String,
			enum: RESPONDER_TYPES,
			required: false,
		},
		approvalStatus: {
			type: String,
			enum: APPROVAL_STATUSES,
			default: "pending",
			required: true,
		},
	},
	{
		timestamps: true,
	},
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true });

userSchema.pre("save", function enforceResponderType(next) {
	if (this.role !== "responder") {
		this.responderType = undefined;
	}
	next();
});

export default mongoose.model("User", userSchema);
