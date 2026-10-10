import mongoose from 'mongoose';

const ExplainableFactorSchema = new mongoose.Schema(
  {
    indicator: { type: String, required: true },
    contribution: { type: String, required: true },
    type: { type: String, default: 'positive' },
    note: { type: String }
  },
  { _id: false }
);

const FutureProjectionSchema = new mongoose.Schema(
  {
    month: { type: String, required: true },
    score: { type: Number, required: true }
  },
  { _id: false }
);

const HistoryEntrySchema = new mongoose.Schema(
  {
    month: { type: String, required: true },
    score: { type: Number, required: true },
    academics: { type: Number },
    attendance: { type: Number },
    placement: { type: Number }
  },
  { _id: false }
);

const StudentProfileSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, index: true },
    academics: {
      cgpa: { type: Number, default: 0 },
      marksPct: { type: Number, default: 0 },
      activeBacklogs: { type: Number, default: 0 },
      completedCredits: { type: Number, default: 0 },
      totalCredits: { type: Number, default: 140 }
    },
    attendance: {
      attendancePct: { type: Number, default: 0 },
      lecturesAttended: { type: Number, default: 0 },
      totalLectures: { type: Number, default: 180 },
      status: { type: String, default: 'safe' }
    },
    lms: {
      assignmentCompletionPct: { type: Number, default: 0 },
      weeklyLogins: { type: Number, default: 0 },
      weeklyStudyHours: { type: Number, default: 0 },
      forumDiscussionsScore: { type: Number, default: 0 }
    },
    engagement: {
      eventsAttended: { type: Number, default: 0 },
      hackathonsCount: { type: Number, default: 0 },
      certificationsCount: { type: Number, default: 0 },
      extracurricularScore: { type: Number, default: 0 }
    },
    placement: {
      aptitudeScore: { type: Number, default: 0 },
      codingChallengeScore: { type: Number, default: 0 },
      mockInterviewScore: { type: Number, default: 0 },
      readinessLevel: { type: String, default: 'not-ready' }
    },
    skillsAssessments: {
      dsaScore: { type: Number, default: 0 },
      systemDesignScore: { type: Number, default: 0 },
      coreCsScore: { type: Number, default: 0 }
    },
    hasProvidedData: { type: Boolean, default: false },
    weeklyTests: [{ type: Object }],
    successScore: { type: Number, default: 0 },
    riskLevel: { type: String, default: 'low' },
    riskFlags: [{ type: String }],
    explainableFactors: [ExplainableFactorSchema],
    futureYou: {
      currentScore: { type: Number },
      projected3MonthScore: { type: Number },
      statement: { type: String },
      targetMilestone: { type: String },
      projections: [FutureProjectionSchema]
    },
    history: [HistoryEntrySchema],
    facultyFeedback: { type: String }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

export const StudentProfile = mongoose.model('StudentProfile', StudentProfileSchema);
export default StudentProfile;
