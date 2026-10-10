import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, default: 'student' },
    batch: { type: String },
    department: { type: String },
    title: { type: String },
    avatar: { type: String },
    joinedAt: { type: String },
    githubUsername: { type: String },
    githubConnected: { type: Boolean, default: false },
    bio: { type: String },
    targetJobRole: { type: String },
    segmentation: { type: String }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const User = mongoose.model('User', UserSchema);
export default User;
