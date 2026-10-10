import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMongoConnected } from './mongoose.js';
import {
  User,
  StudentProfile,
  Streak,
  Project,
  RewardCatalog,
  UserPoints,
  SkillDNA,
  Intervention
} from './models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'data.json');

// Helper to create an uninitialized 0-scale student profile
export function getZeroProfile(studentId) {
  return {
    studentId,
    hasProvidedData: false,
    academics: {
      cgpa: 0,
      marksPct: 0,
      activeBacklogs: 0,
      completedCredits: 0,
      totalCredits: 140
    },
    attendance: {
      attendancePct: 0,
      lecturesAttended: 0,
      totalLectures: 0,
      status: "safe"
    },
    lms: {
      assignmentCompletionPct: 0,
      weeklyLogins: 0,
      weeklyStudyHours: 0,
      forumDiscussionsScore: 0
    },
    engagement: {
      eventsAttended: 0,
      hackathonsCount: 0,
      certificationsCount: 0,
      extracurricularScore: 0
    },
    placement: {
      aptitudeScore: 0,
      codingChallengeScore: 0,
      mockInterviewScore: 0,
      readinessLevel: "not-ready"
    },
    skillsAssessments: {
      dsaScore: 0,
      systemDesignScore: 0,
      coreCsScore: 0
    },
    successScore: 0,
    riskLevel: "low",
    riskFlags: [
      "No academic baseline data submitted yet. Enter your metrics to start tracking."
    ],
    explainableFactors: [],
    futureYou: {
      currentScore: 0,
      projected3MonthScore: 0,
      statement: "Enter your metrics to generate your 3-month future trajectory.",
      targetMilestone: "Awaiting Initial Baseline Data",
      projections: []
    },
    history: [],
    facultyFeedback: "New student account — awaiting baseline academic profile submission.",
    weeklyTests: []
  };
}

// Helper to compute combined unified Student Success Score (0-100)
export function computeSuccessScore(metrics) {
  if (!metrics || metrics.hasProvidedData === false) return 0;

  // If student hasn't entered core academic numbers, return 0
  const academics = metrics.academics || { cgpa: 0, activeBacklogs: 0 };
  const attendance = metrics.attendance || { attendancePct: 0 };
  const lms = metrics.lms || { assignmentCompletionPct: 0, weeklyStudyHours: 0 };
  const engagement = metrics.engagement || { eventsAttended: 0, hackathonsCount: 0, certificationsCount: 0 };
  const placement = metrics.placement || { aptitudeScore: 0, codingChallengeScore: 0, mockInterviewScore: 0 };
  const skills = metrics.skillsAssessments || { dsaScore: 0, systemDesignScore: 0, coreCsScore: 0 };

  if (
    academics.cgpa === 0 &&
    attendance.attendancePct === 0 &&
    lms.assignmentCompletionPct === 0 &&
    placement.codingChallengeScore === 0
  ) {
    return 0;
  }

  // 1. Academics (25% weight): CGPA out of 10, penalize backlogs
  const cgpaNorm = (academics.cgpa / 10) * 100;
  const backlogPenalty = (academics.activeBacklogs || 0) * 12;
  const academicsScore = Math.max(0, Math.min(100, cgpaNorm - backlogPenalty));

  // 2. Attendance (15% weight)
  const attendanceScore = Math.min(100, attendance.attendancePct || 0);

  // 3. LMS & Assignments (20% weight): completion % + hours
  const lmsScore = Math.min(100, ((lms.assignmentCompletionPct || 0) * 0.7) + (Math.min(30, lms.weeklyStudyHours || 0) / 30 * 30));

  // 4. Engagement (10% weight): events, hackathons, certifications
  const engagementScore = Math.min(100, ((engagement.eventsAttended || 0) * 8) + ((engagement.hackathonsCount || 0) * 25) + ((engagement.certificationsCount || 0) * 15));

  // 5. Placement Readiness (20% weight): aptitude + coding + mock interviews
  const placementScore = ((placement.aptitudeScore || 0) * 0.3) + ((placement.codingChallengeScore || 0) * 0.4) + ((placement.mockInterviewScore || 0) * 0.3);

  // 6. Skills Assessments (10% weight)
  const skillsScore = ((skills.dsaScore || 0) * 0.4) + ((skills.systemDesignScore || 0) * 0.3) + ((skills.coreCsScore || 0) * 0.3);

  const combined = (academicsScore * 0.25) +
                   (attendanceScore * 0.15) +
                   (lmsScore * 0.20) +
                   (engagementScore * 0.10) +
                   (placementScore * 0.20) +
                   (skillsScore * 0.10);

  return Math.round(combined * 10) / 10;
}

const INITIAL_DATA = {
  users: [
    {
      id: "u2",
      name: "Dr. Sarah Lin",
      email: "sarah.lin@university.edu",
      password: "password123",
      role: "educator",
      department: "Computer Science & Engineering",
      avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
      title: "Faculty Dean & Lead Academic Advisor"
    }
  ],
  studentProfiles: {},
  streaks: {},
  rewards: {
    catalog: [
      {
        id: "rew-1",
        title: "Streak Freeze Token",
        category: "Safety",
        points: 150,
        description: "Protects your active streak for 24 hours if you miss a day due to exams or travel.",
        icon: "ShieldAlert",
        badge: "Essential"
      },
      {
        id: "rew-2",
        title: "Verified Builder Pro Certificate",
        category: "Credentials",
        points: 300,
        description: "Official cryptographic PDF certification verifying voice project defense for recruiters.",
        icon: "Award",
        badge: "Recruiter Ready"
      },
      {
        id: "rew-3",
        title: "1-on-1 Placement Interview Simulator Pass",
        category: "Placement",
        points: 400,
        description: "Priority 45-minute live technical interview simulation with FAANG panel alumni.",
        icon: "Briefcase",
        badge: "Career Boost"
      },
      {
        id: "rew-4",
        title: "DSA Intensive Bootcamp Pass",
        category: "Learning",
        points: 350,
        description: "Unlocks curated masterclasses on dynamic programming and graph algorithms.",
        icon: "Sparkles",
        badge: "Skills"
      },
      {
        id: "rew-5",
        title: "National Hackathon VIP Priority Entry",
        category: "Events",
        points: 500,
        description: "Guaranteed team sponsor fast-track pass for the Annual Tech Summit Hackathon.",
        icon: "Ticket",
        badge: "Exclusive"
      }
    ],
    userPoints: {}
  },
  leaderboard: {
    students: []
  },
  skillDNA: {},
  githubProjects: [],
  interventions: [],
  weeklyTests: {}
};

let currentData = { ...INITIAL_DATA };

export function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.studentProfiles) {
        currentData = parsed;
      } else {
        currentData = { ...INITIAL_DATA };
        saveData();
      }
    } else {
      saveData();
    }
  } catch (err) {
    console.warn("Using initial state:", err.message);
    currentData = { ...INITIAL_DATA };
  }
  return currentData;
}

export function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(currentData, null, 2), 'utf8');
  } catch (err) {
    console.error("Failed to persist data.json:", err.message);
  }
}

export function getDb() {
  return currentData;
}

// Synchronize memory & local state with MongoDB Atlas
export async function syncMongoWithDb() {
  if (!isMongoConnected()) return;

  try {
    const dummyIds = ['u1', 'u3', 'u4', 'u5', 'u6', 'u1791530537312', 'u1791530651749', 'u1791539655713', 'u1791547002003', 'u1791556442391', 'u1791557116737', 'u1791557146471', 'u1791557179174', 'u1791557310683', 'u1791557484171', 'u1791572116463', 'u1791572302887'];
    await User.deleteMany({ id: { $in: dummyIds } });
    await StudentProfile.deleteMany({ studentId: { $in: dummyIds } });
    await Streak.deleteMany({ studentId: { $in: dummyIds } });
    await UserPoints.deleteMany({ studentId: { $in: dummyIds } });
    await SkillDNA.deleteMany({ studentId: { $in: dummyIds } });
    await Project.deleteMany({ id: { $in: ['repo-1', 'repo-2', 'repo-3'] } });

    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('[MongoDB Atlas] Syncing local clean records to Atlas...');
      if (currentData.users && currentData.users.length) {
        await User.insertMany(currentData.users);
      }
      if (currentData.studentProfiles) {
        const profileDocs = Object.values(currentData.studentProfiles);
        if (profileDocs.length) await StudentProfile.insertMany(profileDocs);
      }
      if (currentData.streaks) {
        const streakDocs = Object.values(currentData.streaks);
        if (streakDocs.length) await Streak.insertMany(streakDocs);
      }
      if (currentData.githubProjects && currentData.githubProjects.length) {
        await Project.insertMany(currentData.githubProjects);
      }
      if (currentData.rewards?.catalog && currentData.rewards.catalog.length) {
        await RewardCatalog.insertMany(currentData.rewards.catalog);
      }
      if (currentData.rewards?.userPoints) {
        const pointsDocs = Object.entries(currentData.rewards.userPoints).map(([studentId, pts]) => ({
          studentId,
          ...pts
        }));
        if (pointsDocs.length) await UserPoints.insertMany(pointsDocs);
      }
      console.log('[MongoDB Atlas] Real-time dataset successfully synced to Atlas.');
    } else {
      console.log(`[MongoDB Atlas] Loading ${userCount} existing users & documents from Atlas...`);
      const users = await User.find({ id: { $nin: dummyIds } }).lean();
      const profiles = await StudentProfile.find({ studentId: { $nin: dummyIds } }).lean();
      const streaks = await Streak.find({ studentId: { $nin: dummyIds } }).lean();
      const projects = await Project.find({ id: { $nin: ['repo-1', 'repo-2', 'repo-3'] } }).lean();
      const catalog = await RewardCatalog.find({}).lean();
      const pointsList = await UserPoints.find({ studentId: { $nin: dummyIds } }).lean();
      const dnaList = await SkillDNA.find({ studentId: { $nin: dummyIds } }).lean();
      const interventions = await Intervention.find({}).lean();

      if (users && users.length) currentData.users = users;
      if (profiles && profiles.length) {
        currentData.studentProfiles = {};
        profiles.forEach(p => {
          if (!p.hasProvidedData || p.successScore === 0) {
            currentData.studentProfiles[p.studentId] = {
              ...getZeroProfile(p.studentId),
              ...p,
              hasProvidedData: false,
              successScore: 0
            };
          } else {
            currentData.studentProfiles[p.studentId] = p;
          }
        });
      }
      if (streaks && streaks.length) {
        currentData.streaks = {};
        streaks.forEach(s => { currentData.streaks[s.studentId] = s; });
      }
      if (projects && projects.length) currentData.githubProjects = projects;
      if (catalog && catalog.length) currentData.rewards.catalog = catalog;
      if (pointsList && pointsList.length) {
        currentData.rewards.userPoints = {};
        pointsList.forEach(up => { currentData.rewards.userPoints[up.studentId] = up; });
      }
      if (dnaList && dnaList.length) {
        currentData.skillDNA = {};
        dnaList.forEach(sd => {
          const prof = currentData.studentProfiles[sd.studentId];
          if (prof && prof.hasProvidedData && prof.successScore > 0) {
            currentData.skillDNA[sd.studentId] = sd;
          }
        });
      }
      if (interventions && interventions.length) currentData.interventions = interventions;

      console.log(`[MongoDB Atlas] Successfully loaded ${users.length} live users from Atlas!`);
    }
  } catch (err) {
    console.error('[MongoDB Atlas] Error during sync:', err.message);
  }
}

// Asynchronously persist any single entity change to MongoDB Atlas
export async function persistToMongo(entityType, payload) {
  if (!isMongoConnected() || !payload) return;
  try {
    switch (entityType) {
      case 'user':
        await User.findOneAndUpdate({ id: payload.id }, payload, { upsert: true, returnDocument: 'after' });
        break;
      case 'profile':
        await StudentProfile.findOneAndUpdate({ studentId: payload.studentId }, payload, { upsert: true, returnDocument: 'after' });
        break;
      case 'streak':
        await Streak.findOneAndUpdate({ studentId: payload.studentId }, payload, { upsert: true, returnDocument: 'after' });
        break;
      case 'points':
        await UserPoints.findOneAndUpdate({ studentId: payload.studentId }, payload, { upsert: true, returnDocument: 'after' });
        break;
      case 'project':
        await Project.findOneAndUpdate({ id: payload.id }, payload, { upsert: true, returnDocument: 'after' });
        break;
      case 'skillDNA':
        await SkillDNA.findOneAndUpdate({ studentId: payload.studentId }, payload, { upsert: true, returnDocument: 'after' });
        break;
      case 'intervention':
        await Intervention.findOneAndUpdate({ id: payload.id }, payload, { upsert: true, returnDocument: 'after' });
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn(`[MongoDB Atlas] Write warning for "${entityType}":`, err.message);
  }
}

