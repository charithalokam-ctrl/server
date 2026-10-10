import mongoose from 'mongoose';

const ProjectFileSchema = new mongoose.Schema(
  {
    path: { type: String, required: true },
    summary: { type: String },
    snippet: { type: String }
  },
  { _id: false }
);

const InterviewAuditSchema = new mongoose.Schema(
  {
    completedAt: { type: String },
    overallScore: { type: Number },
    aiVerdict: { type: String },
    reasoning: { type: String },
    breakdown: {
      architectureRationale: { type: Number },
      codeInternalsMastery: { type: Number },
      failureHandlingDepth: { type: Number },
      aiHallucinationRisk: { type: String }
    },
    questionsAnswered: { type: Number }
  },
  { _id: false }
);

const ProjectSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    studentId: { type: String, required: true, index: true },
    repoName: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String },
    techStack: [{ type: String }],
    stars: { type: Number, default: 0 },
    forks: { type: Number, default: 0 },
    commitsCount: { type: Number, default: 0 },
    lastPushed: { type: String },
    verified: { type: Boolean, default: false },
    verifiedDate: { type: String },
    verificationBadge: { type: String },
    authenticityScore: { type: Number },
    certificateHash: { type: String },
    files: [ProjectFileSchema],
    interviewAudit: InterviewAuditSchema
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const Project = mongoose.model('Project', ProjectSchema);
export default Project;
