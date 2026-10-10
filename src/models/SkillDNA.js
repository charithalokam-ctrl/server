import mongoose from 'mongoose';

const SkillNodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    level: { type: Number, required: true },
    maxLevel: { type: Number, default: 10 },
    growth: { type: String },
    color: { type: String, default: '#38bdf8' },
    completedTopics: { type: Number, default: 0 },
    totalTopics: { type: Number, default: 20 }
  },
  { _id: false }
);

const AiRecommendationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    topic: { type: String, required: true },
    category: { type: String, required: true },
    reason: { type: String },
    estimatedMinutes: { type: Number, default: 30 },
    xpGain: { type: Number, default: 100 },
    difficulty: { type: String, default: 'Intermediate' },
    completed: { type: Boolean, default: false }
  },
  { _id: false }
);

const SkillDNASchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, index: true },
    skills: [SkillNodeSchema],
    aiRecommendations: [AiRecommendationSchema]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const SkillDNA = mongoose.model('SkillDNA', SkillDNASchema);
export default SkillDNA;
