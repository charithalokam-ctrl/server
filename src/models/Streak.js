import mongoose from 'mongoose';

const MilestoneSchema = new mongoose.Schema(
  {
    days: { type: Number, required: true },
    title: { type: String, required: true },
    achieved: { type: Boolean, default: false },
    date: { type: String, default: null },
    icon: { type: String, default: 'Flame' }
  },
  { _id: false }
);

const WeeklyCheckinSchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    active: { type: Boolean, default: false }
  },
  { _id: false }
);

const StreakSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, index: true },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    freezeTokens: { type: Number, default: 1 },
    freezeTokensUsedTotal: { type: Number, default: 0 },
    todayCheckedIn: { type: Boolean, default: false },
    lastCheckinDate: { type: String },
    usualLoginTime: { type: String, default: '09:30' },
    streakProtectionActive: { type: Boolean, default: true },
    milestones: [MilestoneSchema],
    weeklyCheckins: [WeeklyCheckinSchema]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const Streak = mongoose.model('Streak', StreakSchema);
export default Streak;
