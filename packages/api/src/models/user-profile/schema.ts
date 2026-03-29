import mongoose, { Schema, Document } from "mongoose";

export interface UserProfileProps {
  userId: string;
  email: string;
  name: string;
  activeOrgId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type UserProfileDocument = UserProfileProps & Document;

const userProfileSchema = new Schema<UserProfileDocument>({
  userId: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true },
  name: { type: String, default: "" },
  activeOrgId: { type: String, default: null },
  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() },
});

userProfileSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

export const UserProfileModel = (mongoose.models?.["UserProfile"] as mongoose.Model<UserProfileDocument>) ||
  mongoose.model<UserProfileDocument>("UserProfile", userProfileSchema);
