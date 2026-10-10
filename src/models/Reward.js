import mongoose from 'mongoose';

const RewardCatalogSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    points: { type: Number, required: true },
    description: { type: String },
    icon: { type: String, default: 'Award' },
    badge: { type: String }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

const RedeemedRecordSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    rewardId: { type: String, required: true },
    title: { type: String, required: true },
    points: { type: Number, required: true },
    date: { type: String, required: true }
  },
  { _id: false }
);

const UserPointsSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, index: true },
    totalEarned: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    redeemedHistory: [RedeemedRecordSchema]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const RewardCatalog = mongoose.model('RewardCatalog', RewardCatalogSchema);
export const UserPoints = mongoose.model('UserPoints', UserPointsSchema);

export default { RewardCatalog, UserPoints };
