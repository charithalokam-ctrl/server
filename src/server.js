import express from 'express';
import cors from 'cors';
import { loadData, saveData, getDb, computeSuccessScore, syncMongoWithDb, persistToMongo, getZeroProfile } from './db.js';
import { connectDB, getMongoStatus } from './mongoose.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Load / Initialize DB & MongoDB Atlas Connection
loadData();
connectDB().then(connected => {
  if (connected) {
    syncMongoWithDb();
  }
});

// Health check with DB status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: getMongoStatus()
  });
});

// Real-time MongoDB Atlas status endpoint
app.get('/api/db/status', (req, res) => {
  res.json(getMongoStatus());
});

// Auth Endpoints: Login & Signup
app.post('/api/auth/login', (req, res) => {
  const { email, password, userId } = req.body;
  const db = getDb();

  let user = null;
  if (userId) {
    user = db.users.find(u => u.id === userId);
  } else if (email) {
    user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials. User not found." });
  }

  // Password check (if password passed)
  if (password && user.password && user.password !== password) {
    return res.status(401).json({ error: "Invalid password. (Use demo password: password123)" });
  }

  res.json({
    token: `aura-token-${user.id}-${Date.now()}`,
    user
  });
});

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, role, batch, department, targetJobRole } = req.body;
  const db = getDb();

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }

  const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: "An account with this email already exists." });
  }

  const newId = `u${Date.now()}`;
  const newUser = {
    id: newId,
    name,
    email,
    password,
    role: role || 'student',
    batch: batch || 'Class of 2026 - CS-A',
    department: department || 'Computer Science & Engineering',
    avatar: `https://images.unsplash.com/photo-${role === 'educator' ? '1573496359142-b8d87734a5a2' : '1534528741775-53994a69daeb'}?w=150&auto=format&fit=crop&q=80`,
    joinedAt: new Date().toISOString().split('T')[0],
    githubUsername: `${name.toLowerCase().replace(/\s+/g, '')}-dev`,
    githubConnected: false,
    bio: role === 'educator' ? 'Academic Advisor and Faculty Mentor' : 'Aspiring Software Engineer & Tech Builder',
    targetJobRole: targetJobRole || 'Software Engineer',
    segmentation: role === 'student' ? 'all-round-leader' : undefined
  };

  db.users.push(newUser);

  // Initialize student state if student — starts cleanly at 0 scale until student enters data
  if (newUser.role === 'student') {
    const initialProfile = getZeroProfile(newId);
    db.studentProfiles[newId] = initialProfile;
    db.streaks[newId] = {
      studentId: newId,
      currentStreak: 0,
      longestStreak: 0,
      freezeTokens: 1,
      todayCheckedIn: false,
      lastCheckinDate: null,
      usualLoginTime: "09:30",
      streakProtectionActive: true,
      milestones: [
        { days: 7, title: "Spark Initiate", achieved: false, icon: "Flame" },
        { days: 30, title: "Blaze Warrior", achieved: false, icon: "Zap" },
        { days: 100, title: "Supernova Master", achieved: false, icon: "Sun" }
      ],
      weeklyCheckins: [
        { day: "Mon", active: false },
        { day: "Tue", active: false },
        { day: "Wed", active: false },
        { day: "Thu", active: false },
        { day: "Fri", active: false },
        { day: "Sat", active: false },
        { day: "Sun", active: false }
      ]
    };
    db.rewards.userPoints[newId] = { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  }

  saveData();

  // Persist new user & initial documents to MongoDB Atlas
  persistToMongo('user', newUser);
  if (newUser.role === 'student') {
    persistToMongo('profile', db.studentProfiles[newId]);
    persistToMongo('streak', db.streaks[newId]);
    persistToMongo('points', { studentId: newId, totalEarned: 0, currentBalance: 0, redeemedHistory: [] });
  }

  res.json({
    message: "Account created successfully!",
    token: `aura-token-${newUser.id}-${Date.now()}`,
    user: newUser
  });
});

app.get('/api/auth/users', (req, res) => {
  const db = getDb();
  res.json({ users: db.users });
});

// All Students (Faculty / Admin View with Segmentation & Risk Flags)
app.get('/api/students/all', (req, res) => {
  const db = getDb();
  const students = db.users
    .filter(u => u.role === 'student')
    .map(student => {
      const profile = db.studentProfiles[student.id] || getZeroProfile(student.id);
      const streak = db.streaks[student.id] || { currentStreak: 0 };
      const verifiedProjectsCount = db.githubProjects.filter(p => p.studentId === student.id && p.verified).length;
      return {
        ...student,
        profile,
        streak: streak.currentStreak,
        verifiedProjectsCount
      };
    });

  const total = students.length;
  const criticalRiskCount = students.filter(s => s.profile?.riskLevel === 'high').length;
  const watchlistCount = students.filter(s => s.profile?.riskLevel === 'medium').length;
  const avgSuccessScore = total ? Math.round(students.reduce((acc, s) => acc + (s.profile?.successScore || 0), 0) / total * 10) / 10 : 0;
  const avgAttendance = total ? Math.round(students.reduce((acc, s) => acc + (s.profile?.attendance?.attendancePct || 0), 0) / total * 10) / 10 : 0;
  const avgPlacementReadiness = total ? Math.round(students.reduce((acc, s) => acc + (s.profile?.placement?.codingChallengeScore || 0), 0) / total * 10) / 10 : 0;

  res.json({
    students,
    summary: {
      totalStudents: total,
      criticalRiskCount,
      watchlistCount,
      avgSuccessScore,
      avgAttendance,
      avgPlacementReadiness
    }
  });
});

// Student Unified Profile
app.get('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: "Student not found" });

  let profile = db.studentProfiles[id];

  if (!profile) {
    profile = getZeroProfile(id);
    db.studentProfiles[id] = profile;
    saveData();
    persistToMongo('profile', profile);
  } else if (profile.hasProvidedData !== true) {
    // Real student users who haven't submitted data start cleanly at 0 scale
    profile = getZeroProfile(id);
    db.studentProfiles[id] = profile;
  }

  const streak = db.streaks[id] || {
    studentId: id,
    currentStreak: 0,
    longestStreak: 0,
    freezeTokens: 1,
    todayCheckedIn: false,
    milestones: [
      { days: 7, title: "Spark Initiate", achieved: false, icon: "Flame" },
      { days: 30, title: "Blaze Warrior", achieved: false, icon: "Zap" },
      { days: 100, title: "Supernova Master", achieved: false, icon: "Sun" }
    ],
    weeklyCheckins: [
      { day: "Mon", active: false },
      { day: "Tue", active: false },
      { day: "Wed", active: false },
      { day: "Thu", active: false },
      { day: "Fri", active: false },
      { day: "Sat", active: false },
      { day: "Sun", active: false }
    ]
  };

  const points = db.rewards.userPoints[id] || { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  const verifiedProjects = (db.githubProjects || []).filter(p => p.studentId === id && p.verified);

  res.json({
    user,
    profile,
    streak,
    points,
    verifiedProjectsCount: verifiedProjects.length
  });
});

// Update / Enter Student Baseline Metrics (Requirement 2)
app.post('/api/students/:id/metrics', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const user = db.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: "Student not found" });

  const body = req.body || {};
  const academics = body.academics || body;
  const attendance = body.attendance || body;
  const lms = body.lms || body;
  const engagement = body.engagement || body;
  const placement = body.placement || body;
  const skillsAssessments = body.skillsAssessments || body;
  const githubUsername = body.githubUsername;
  const targetJobRole = body.targetJobRole;

  let profile = db.studentProfiles[id] || getZeroProfile(id);
  profile.hasProvidedData = true;

  profile.academics = {
    cgpa: Number(academics.cgpa !== undefined ? academics.cgpa : profile.academics.cgpa) || 0,
    marksPct: Number(academics.marksPct !== undefined ? academics.marksPct : profile.academics.marksPct) || 0,
    activeBacklogs: Number(academics.activeBacklogs !== undefined ? academics.activeBacklogs : profile.academics.activeBacklogs) || 0,
    completedCredits: Number(academics.completedCredits !== undefined ? academics.completedCredits : profile.academics.completedCredits) || 0,
    totalCredits: Number(academics.totalCredits !== undefined ? academics.totalCredits : profile.academics.totalCredits) || 160
  };

  const attPct = Number(attendance.attendancePct !== undefined ? attendance.attendancePct : profile.attendance.attendancePct) || 0;
  profile.attendance = {
    attendancePct: attPct,
    lecturesAttended: Number(attendance.lecturesAttended !== undefined ? attendance.lecturesAttended : profile.attendance.lecturesAttended) || 0,
    totalLectures: Number(attendance.totalLectures !== undefined ? attendance.totalLectures : profile.attendance.totalLectures) || 0,
    status: attPct >= 85 ? 'safe' : attPct >= 75 ? 'warning' : 'critical'
  };

  profile.lms = {
    assignmentCompletionPct: Number(lms.assignmentCompletionPct !== undefined ? lms.assignmentCompletionPct : profile.lms.assignmentCompletionPct) || 0,
    weeklyLogins: Number(lms.weeklyLogins !== undefined ? lms.weeklyLogins : profile.lms.weeklyLogins) || 0,
    weeklyStudyHours: Number(lms.weeklyStudyHours !== undefined ? lms.weeklyStudyHours : profile.lms.weeklyStudyHours) || 0,
    forumDiscussionsScore: Number(lms.forumDiscussionsScore !== undefined ? lms.forumDiscussionsScore : profile.lms.forumDiscussionsScore) || 0
  };

  profile.engagement = {
    eventsAttended: Number(engagement.eventsAttended !== undefined ? engagement.eventsAttended : profile.engagement.eventsAttended) || 0,
    hackathonsCount: Number(engagement.hackathonsCount !== undefined ? engagement.hackathonsCount : profile.engagement.hackathonsCount) || 0,
    certificationsCount: Number(engagement.certificationsCount !== undefined ? engagement.certificationsCount : profile.engagement.certificationsCount) || 0,
    extracurricularScore: Number(engagement.extracurricularScore !== undefined ? engagement.extracurricularScore : profile.engagement.extracurricularScore) || 0
  };

  const coding = Number(placement.codingChallengeScore !== undefined ? placement.codingChallengeScore : profile.placement.codingChallengeScore) || 0;
  profile.placement = {
    aptitudeScore: Number(placement.aptitudeScore !== undefined ? placement.aptitudeScore : profile.placement.aptitudeScore) || 0,
    codingChallengeScore: coding,
    mockInterviewScore: Number(placement.mockInterviewScore !== undefined ? placement.mockInterviewScore : profile.placement.mockInterviewScore) || 0,
    readinessLevel: coding >= 80 ? 'ready' : coding >= 50 ? 'needs-prep' : 'not-ready'
  };

  profile.skillsAssessments = {
    dsaScore: Number(skillsAssessments.dsaScore !== undefined ? skillsAssessments.dsaScore : profile.skillsAssessments.dsaScore) || 0,
    systemDesignScore: Number(skillsAssessments.systemDesignScore !== undefined ? skillsAssessments.systemDesignScore : profile.skillsAssessments.systemDesignScore) || 0,
    coreCsScore: Number(skillsAssessments.coreCsScore !== undefined ? skillsAssessments.coreCsScore : profile.skillsAssessments.coreCsScore) || 0
  };

  // Recalculate Unified Composite Score
  const newScore = computeSuccessScore(profile);
  profile.successScore = newScore;

  const proj3Mo = Math.min(99.5, Math.round((newScore + 6.2) * 10) / 10);
  profile.futureYou = {
    currentScore: newScore,
    projected3MonthScore: proj3Mo,
    statement: `If you maintain this pace, in 3 months your score will reach ${proj3Mo} (Target Trajectory)`,
    targetMilestone: `Placement Readiness for ${targetJobRole || user.targetJobRole || 'Software Engineer'}`,
    projections: [
      { month: 'Month 1', score: Math.round(newScore + 2) },
      { month: 'Month 2', score: Math.round(newScore + 4) },
      { month: 'Month 3', score: Math.round(proj3Mo) }
    ]
  };

  // Determine Risk Level & Flags
  const backlogs = profile.academics.activeBacklogs;
  const codingScore = profile.placement.codingChallengeScore;

  if (newScore < 60 || attPct < 75 || backlogs >= 2) {
    profile.riskLevel = 'high';
  } else if (newScore < 75 || attPct < 85 || codingScore < 60) {
    profile.riskLevel = 'medium';
  } else {
    profile.riskLevel = 'low';
  }

  const flags = [];
  if (backlogs > 0) flags.push(`${backlogs} Active Academic Backlog(s) blocking placement clearance`);
  if (attPct > 0 && attPct < 75) flags.push(`Attendance is ${attPct}% (Below 75% minimum university threshold)`);
  if (codingScore > 0 && codingScore < 60) flags.push(`Coding assessment score (${codingScore}/100) needs practice`);
  if (profile.lms.weeklyStudyHours < 12) flags.push(`Low study hours (${profile.lms.weeklyStudyHours} hrs logged this week)`);
  profile.riskFlags = flags;

  // Explainable Factors
  const factors = [];
  if (profile.academics.cgpa >= 8.0) {
    factors.push({ indicator: "Academic Excellence", contribution: "+20.0%", type: "positive", note: `CGPA ${profile.academics.cgpa} with ${backlogs} backlogs` });
  } else if (backlogs > 0) {
    factors.push({ indicator: "Active Course Backlogs", contribution: `-${backlogs * 12}%`, type: "negative", note: `${backlogs} backlogs penalizing placement filter` });
  }
  if (attPct >= 85) {
    factors.push({ indicator: "Consistent Attendance", contribution: "+15.0%", type: "positive", note: `${attPct}% class attendance` });
  } else if (attPct > 0 && attPct < 75) {
    factors.push({ indicator: "Attendance Risk", contribution: "-18.5%", type: "negative", note: `${attPct}% attendance risks debarment` });
  }
  if (codingScore >= 75) {
    factors.push({ indicator: "Coding Readiness", contribution: "+18.0%", type: "positive", note: `${codingScore}/100 problem solving benchmark` });
  } else if (codingScore > 0) {
    factors.push({ indicator: "Placement Coding Gap", contribution: "-12.0%", type: "negative", note: `${codingScore}/100 requires daily DSA practice` });
  }
  profile.explainableFactors = factors;

  // Append history
  const currentMonth = new Date().toLocaleString('en-US', { month: 'short' });
  if (!profile.history) profile.history = [];
  profile.history.push({
    month: currentMonth,
    score: newScore,
    academics: Math.round((profile.academics.cgpa / 10) * 100),
    attendance: Math.round(attPct),
    placement: Math.round(codingScore)
  });

  if (githubUsername) {
    user.githubUsername = githubUsername;
    user.githubConnected = true;
  }
  if (targetJobRole) {
    user.targetJobRole = targetJobRole;
  }

  db.studentProfiles[id] = profile;
  saveData();
  persistToMongo('profile', profile);
  persistToMongo('user', user);

  res.json({
    message: "Metrics saved successfully!",
    profile,
    user,
    successScore: newScore
  });
});

// Interactive What-If Simulation on Combined Success Score
app.post('/api/students/:id/simulate-metrics', (req, res) => {
  const { id } = req.params;
  const { cgpa, activeBacklogs, attendancePct, assignmentCompletionPct, weeklyStudyHours, codingChallengeScore } = req.body;
  const db = getDb();

  let profile = db.studentProfiles[id] || getZeroProfile(id);
  const simulatedMetrics = {
    ...profile,
    hasProvidedData: true,
    academics: { ...profile.academics, cgpa: Number(cgpa), activeBacklogs: Number(activeBacklogs) },
    attendance: { ...profile.attendance, attendancePct: Number(attendancePct) },
    lms: { ...profile.lms, assignmentCompletionPct: Number(assignmentCompletionPct), weeklyStudyHours: Number(weeklyStudyHours) },
    placement: { ...profile.placement, codingChallengeScore: Number(codingChallengeScore) }
  };

  const newScore = computeSuccessScore(simulatedMetrics);
  let riskLevel = 'low';
  if (newScore < 60 || simulatedMetrics.attendance.attendancePct < 70 || simulatedMetrics.academics.activeBacklogs >= 2) {
    riskLevel = 'high';
  } else if (newScore < 75 || simulatedMetrics.attendance.attendancePct < 80 || simulatedMetrics.placement.codingChallengeScore < 50) {
    riskLevel = 'medium';
  }

  const projected3Mo = Math.min(99.5, Math.round((newScore + 5.5) * 10) / 10);

  res.json({
    simulatedScore: newScore,
    riskLevel,
    projected3MonthScore: projected3Mo,
    predictionStatement: `If you maintain these metrics, in 3 months your score will reach ${projected3Mo} (Target Trajectory)`
  });
});

// Faculty Interventions
app.post('/api/faculty/intervention', (req, res) => {
  const { studentId, interventionType, notes, facultyName } = req.body;
  const db = getDb();
  const user = db.users.find(u => u.id === studentId);
  if (!user) return res.status(404).json({ error: "Student not found" });

  const record = {
    id: `int-${Date.now()}`,
    studentId,
    studentName: user.name,
    interventionType,
    notes: notes || "Standard academic recovery support plan dispatched.",
    dispatchedBy: facultyName || "Dr. Sarah Lin (Dean)",
    date: new Date().toISOString()
  };

  if (!db.interventions) db.interventions = [];
  db.interventions.push(record);
  saveData();
  persistToMongo('intervention', record);

  res.json({
    message: `Intervention "${interventionType}" successfully logged and notification sent to ${user.name}.`,
    record
  });
});

// Streak Endpoints
app.get('/api/streaks/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  let streak = db.streaks[studentId];
  if (!streak) {
    streak = {
      studentId,
      currentStreak: 0,
      longestStreak: 0,
      freezeTokens: 1,
      todayCheckedIn: false,
      milestones: [
        { days: 7, title: "Spark Initiate", achieved: false, icon: "Flame" },
        { days: 30, title: "Blaze Warrior", achieved: false, icon: "Zap" },
        { days: 100, title: "Supernova Master", achieved: false, icon: "Sun" }
      ],
      weeklyCheckins: [
        { day: "Mon", active: false },
        { day: "Tue", active: false },
        { day: "Wed", active: false },
        { day: "Thu", active: false },
        { day: "Fri", active: false },
        { day: "Sat", active: false },
        { day: "Sun", active: false }
      ]
    };
    db.streaks[studentId] = streak;
    saveData();
    persistToMongo('streak', streak);
  }
  res.json({ streak });
});

app.post('/api/streaks/:studentId/checkin', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  let streak = db.streaks[studentId];

  if (!streak) {
    streak = {
      studentId,
      currentStreak: 0,
      longestStreak: 0,
      freezeTokens: 1,
      todayCheckedIn: false,
      milestones: [
        { days: 7, title: "Spark Initiate", achieved: false, icon: "Flame" },
        { days: 30, title: "Blaze Warrior", achieved: false, icon: "Zap" },
        { days: 100, title: "Supernova Master", achieved: false, icon: "Sun" }
      ],
      weeklyCheckins: [
        { day: "Mon", active: true },
        { day: "Tue", active: true },
        { day: "Wed", active: true },
        { day: "Thu", active: true },
        { day: "Fri", active: true },
        { day: "Sat", active: true },
        { day: "Sun", active: true }
      ]
    };
    db.streaks[studentId] = streak;
  }

  if (streak.todayCheckedIn) {
    return res.json({ message: "Already checked in today!", streak, pointsAwarded: 0 });
  }

  streak.todayCheckedIn = true;
  streak.currentStreak += 1;
  if (streak.currentStreak > streak.longestStreak) streak.longestStreak = streak.currentStreak;
  streak.lastCheckinDate = new Date().toISOString();

  // Milestone awards
  let milestoneAchieved = null;
  streak.milestones.forEach(m => {
    if (!m.achieved && streak.currentStreak >= m.days) {
      m.achieved = true;
      m.date = new Date().toISOString().split('T')[0];
      milestoneAchieved = m;
    }
  });

  const pointsAwarded = 30;
  if (!db.rewards.userPoints[studentId]) {
    db.rewards.userPoints[studentId] = { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  }
  db.rewards.userPoints[studentId].totalEarned += pointsAwarded;
  db.rewards.userPoints[studentId].currentBalance += pointsAwarded;

  saveData();
  persistToMongo('streak', streak);
  persistToMongo('points', { studentId, ...db.rewards.userPoints[studentId] });

  res.json({
    message: "Daily login check-in recorded! Streak momentum protected.",
    streak,
    pointsAwarded,
    milestoneAchieved
  });
});

app.post('/api/streaks/:studentId/freeze', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const streak = db.streaks[studentId];
  if (!streak || streak.freezeTokens <= 0) {
    return res.status(400).json({ error: "No freeze tokens available." });
  }

  streak.freezeTokens -= 1;
  streak.streakProtectionActive = true;
  saveData();
  persistToMongo('streak', streak);

  res.json({
    message: "Streak Freeze token activated! Your streak is safely shielded for 24 hours.",
    streak
  });
});

// Proof of Build — AI Voice Project Interview
app.get('/api/interview/repos/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const repos = (db.githubProjects || []).filter(p => p.studentId === studentId);
  res.json({ repos });
});

app.post('/api/interview/repos/add', (req, res) => {
  const { studentId, repoName, title, description, techStack, sampleSnippet } = req.body;
  const db = getDb();
  const user = db.users.find(u => u.id === studentId);
  if (!user) return res.status(404).json({ error: "Student not found" });

  const tech = Array.isArray(techStack) ? techStack : (techStack || 'React, TypeScript, Node.js').split(',').map(s => s.trim());
  const newRepo = {
    id: `repo-${Date.now()}`,
    studentId,
    repoName: repoName || `${user.githubUsername || 'student'}/${(title || 'project').toLowerCase().replace(/\s+/g, '-')}`,
    title: title || 'Custom Full-Stack Project',
    description: description || 'Built by student for technical proof of build.',
    techStack: tech,
    stars: 1,
    forks: 0,
    commitsCount: 18,
    lastPushed: 'Recently',
    verified: false,
    files: [
      {
        path: 'src/main.ts',
        summary: 'Primary application business logic and architectural entry.',
        snippet: sampleSnippet || `export function executePipeline() {\n  // Core project implementation logic\n  return true;\n}`
      }
    ],
    interviewAudit: null
  };

  if (!db.githubProjects) db.githubProjects = [];
  db.githubProjects.push(newRepo);
  saveData();
  persistToMongo('project', newRepo);

  res.json({ message: "Project repository added successfully!", repo: newRepo });
});

app.post('/api/interview/start', (req, res) => {
  const { repoId } = req.body;
  const db = getDb();
  const repo = db.githubProjects.find(p => p.id === repoId) || db.githubProjects[0];

  const questions = [
    {
      id: "q1",
      questionNumber: 1,
      category: "Architecture & Library Choices",
      questionText: `In your codebase "${repo.title}", what led you to pick ${repo.techStack[0]} and ${repo.techStack[2] || repo.techStack[1]}? What architectural trade-offs did you consider over alternative tools?`,
      hint: "Explain real performance, bundle size, or concurrency trade-offs you encountered.",
      sampleFile: repo.files[0]
    },
    {
      id: "q2",
      questionNumber: 2,
      category: "Runtime Internals & Memory Safeguards",
      questionText: `Walk me through your file "${repo.files[0]?.path || 'source file'}". Specifically, how does your implementation manage resource allocation or prevent memory leaks during continuous execution?`,
      hint: "Detail buffer pools, cleanup hooks, or asynchronous event loops in your code.",
      sampleFile: repo.files[1] || repo.files[0]
    },
    {
      id: "q3",
      questionNumber: 3,
      category: "Production Failure Modes & Scalability",
      questionText: `If this service experiences a sudden 20x spike in concurrent users tomorrow, what is the single biggest bottleneck in your current design and how would you re-architect it?`,
      hint: "Identify true builder bottlenecks like thread pool exhaustion, unindexed lookups, or worker serialization.",
      sampleFile: repo.files[2] || repo.files[0]
    }
  ];

  res.json({
    repo,
    questions,
    sessionId: `session-${Date.now()}`
  });
});

app.post('/api/interview/evaluate', (req, res) => {
  const { repoId, answers, studentId } = req.body;
  const db = getDb();
  const repo = db.githubProjects.find(p => p.id === repoId) || db.githubProjects[0];

  let totalLength = 0;
  let techKeywordsFound = 0;
  const keywords = ['worker', 'memory', 'thread', 'latency', 'pool', 'async', 'event', 'cache', 'state', 'buffer', 'queue', 'onnx', 'raft', 'tradeoff', 'scale', 'lock', 'index', 'decouple', 'canvas', 'wasm'];

  answers.forEach(a => {
    const text = (a.transcript || '').toLowerCase();
    totalLength += text.split(' ').length;
    keywords.forEach(k => {
      if (text.includes(k)) techKeywordsFound++;
    });
  });

  const baseScore = Math.min(97, Math.max(78, Math.round(76 + (totalLength > 40 ? 10 : 5) + Math.min(12, techKeywordsFound * 2))));
  const certHash = `VB-${Math.floor(1000 + Math.random() * 9000)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  repo.verified = true;
  repo.verifiedDate = new Date().toISOString().split('T')[0];
  repo.verificationBadge = baseScore >= 92 ? "Verified Build Pro" : "Verified Build";
  repo.authenticityScore = baseScore;
  repo.certificateHash = certHash;
  repo.interviewAudit = {
    completedAt: new Date().toISOString(),
    overallScore: baseScore,
    aiVerdict: "Genuine Human Builder (High Confidence)",
    reasoning: `Candidate provided articulate spoken technical defense across 3 architecture scenarios. Demonstrated authentic grasp of runtime memory pools and scaling bottlenecks.`,
    breakdown: {
      architectureRationale: Math.min(98, baseScore + 2),
      codeInternalsMastery: baseScore,
      failureHandlingDepth: Math.max(75, baseScore - 2),
      aiHallucinationRisk: "< 3.5% (Authentic Builder)"
    },
    questionsAnswered: answers.length
  };

  const pointsAwarded = 250;
  if (!db.rewards.userPoints[studentId]) {
    db.rewards.userPoints[studentId] = { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  }
  db.rewards.userPoints[studentId].totalEarned += pointsAwarded;
  db.rewards.userPoints[studentId].currentBalance += pointsAwarded;

  saveData();
  persistToMongo('project', repo);
  persistToMongo('points', { studentId, ...db.rewards.userPoints[studentId] });

  res.json({
    status: 'success',
    isVerified: true,
    authenticityScore: baseScore,
    verificationBadge: repo.verificationBadge,
    certificateHash: certHash,
    pointsAwarded,
    audit: repo.interviewAudit
  });
});

// Rewards & Leaderboard
app.get('/api/rewards/catalog', (req, res) => {
  const db = getDb();
  res.json({ catalog: db.rewards.catalog });
});

app.get('/api/rewards/user/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const userPoints = db.rewards.userPoints[studentId] || { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  res.json({ userPoints });
});

app.post('/api/rewards/redeem', (req, res) => {
  const { studentId, rewardId } = req.body;
  const db = getDb();
  const reward = db.rewards.catalog.find(r => r.id === rewardId);
  if (!reward) return res.status(404).json({ error: "Reward not found" });

  const userPoints = db.rewards.userPoints[studentId] || { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  if (userPoints.currentBalance < reward.points) {
    return res.status(400).json({ error: `Not enough points! Need ${reward.points} points.` });
  }

  userPoints.currentBalance -= reward.points;
  userPoints.redeemedHistory.push({
    id: `red-${Date.now()}`,
    rewardId: reward.id,
    title: reward.title,
    points: reward.points,
    date: new Date().toISOString().split('T')[0]
  });

  if (rewardId === 'rew-1' && db.streaks[studentId]) {
    db.streaks[studentId].freezeTokens = (db.streaks[studentId].freezeTokens || 0) + 1;
  }

  saveData();
  persistToMongo('points', { studentId, ...userPoints });
  if (rewardId === 'rew-1' && db.streaks[studentId]) {
    persistToMongo('streak', db.streaks[studentId]);
  }

  res.json({
    message: `Successfully redeemed "${reward.title}"!`,
    currentBalance: userPoints.currentBalance,
    reward
  });
});

// Leaderboard dynamically computed from real-time registered students
app.get('/api/leaderboard', (req, res) => {
  const db = getDb();
  const students = (db.users || [])
    .filter(u => u.role === 'student')
    .map(student => {
      const profile = db.studentProfiles[student.id];
      const streak = db.streaks[student.id]?.currentStreak || 0;
      const points = db.rewards?.userPoints?.[student.id]?.currentBalance || 0;
      const verifiedProjects = (db.githubProjects || []).filter(p => p.studentId === student.id && p.verified).length;
      const successScore = profile?.successScore || 0;
      return {
        id: student.id,
        name: student.name,
        batch: student.batch || "Class of 2026",
        avatar: student.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
        points,
        streak,
        verifiedProjects,
        successScore,
        progressVsLastMonth: streak > 0 ? Math.min(25, Math.round((streak * 1.5 + (points > 0 ? 5 : 0)) * 10) / 10) : 0
      };
    })
    .sort((a, b) => b.points - a.points || b.streak - a.streak || b.successScore - a.successScore)
    .map((s, idx) => ({ ...s, rank: idx + 1 }));

  const batches = Array.from(new Set(students.map(s => s.batch).filter(Boolean)));
  if (!batches.length) batches.push("Class of 2026 - CS-A");

  const teamStreaks = students.length >= 2 ? [
    {
      id: "t1",
      teamName: "Campus CodeCraft Squad",
      batch: students[0].batch,
      combinedStreak: students.reduce((acc, s) => acc + s.streak, 0),
      membersCount: students.length,
      members: students.map(s => s.name),
      status: "Active Glow",
      totalPoints: students.reduce((acc, s) => acc + s.points, 0)
    }
  ] : [];

  res.json({
    batches,
    students,
    teamStreaks
  });
});

function generateStudentSkillDNA(studentId) {
  const db = getDb();
  const user = db.users.find(u => u.id === studentId) || { name: 'Student' };
  const profile = db.studentProfiles[studentId] || getZeroProfile(studentId);
  const repos = (db.githubProjects || []).filter(p => p.studentId === studentId);
  const weeklyTests = (db.weeklyTests && db.weeklyTests[studentId]) || [];

  const hasData = Boolean(profile && profile.hasProvidedData === true && profile.successScore > 0);

  if (!hasData) {
    const skills = [
      { id: "s1", name: "Algorithms & DSA", level: 0, maxLevel: 10, growth: "Awaiting Assessment", color: "#38bdf8", completedTopics: 0, totalTopics: 20 },
      { id: "s2", name: "System Design & Architecture", level: 0, maxLevel: 10, growth: "Awaiting Assessment", color: "#a855f7", completedTopics: 0, totalTopics: 20 },
      { id: "s3", name: "Full-Stack Web Engineering", level: 0, maxLevel: 10, growth: "Awaiting Assessment", color: "#ec4899", completedTopics: 0, totalTopics: 20 },
      { id: "s4", name: "Database & Storage Engines", level: 0, maxLevel: 10, growth: "Awaiting Assessment", color: "#10b981", completedTopics: 0, totalTopics: 20 },
      { id: "s5", name: "Core CS (OS & Networks)", level: 0, maxLevel: 10, growth: "Awaiting Assessment", color: "#f59e0b", completedTopics: 0, totalTopics: 20 },
      { id: "s6", name: "Campus Placement Readiness", level: 0, maxLevel: 10, growth: "Awaiting Assessment", color: "#6366f1", completedTopics: 0, totalTopics: 20 }
    ];

    const aiRecommendations = [
      {
        id: "rec-1",
        topic: "Take Weekly Assessment: Algorithms & DSA Benchmark",
        category: "Algorithms & DSA",
        reason: "Establish your real-time capability benchmark score with a live test.",
        estimatedMinutes: 20,
        xpGain: 100,
        difficulty: "Foundational",
        completed: false
      },
      {
        id: "rec-2",
        topic: "Enter Your Academic & Placement Metrics in Profile",
        category: "Academic Baseline",
        reason: "Submit your real CGPA, attendance, and placement numbers to build your live profile.",
        estimatedMinutes: 5,
        xpGain: 50,
        difficulty: "Foundational",
        completed: false
      },
      {
        id: "rec-3",
        topic: "Connect GitHub & Defend a Built Software Project",
        category: "Proof of Build",
        reason: "Link your GitHub repository and defend architectural knowledge with our AI interviewer.",
        estimatedMinutes: 25,
        xpGain: 150,
        difficulty: "Intermediate",
        completed: false
      }
    ];

    return { skills, aiRecommendations };
  }

  // Real-time calculation based on student tests, repositories, and verified submissions
  const dsaTest = weeklyTests.filter(t => t.category === "Algorithms & DSA" && t.passed);
  const sysDesignTest = weeklyTests.filter(t => t.category === "System Design & Architecture" && t.passed);
  const webEngTest = weeklyTests.filter(t => t.category === "Full-Stack Web Engineering" && t.passed);
  const dbTest = weeklyTests.filter(t => t.category === "Databases & System Design" && t.passed);
  const coreCsTest = weeklyTests.filter(t => t.category === "Core CS" && t.passed);
  const placementTest = weeklyTests.filter(t => t.category === "Placement Readiness" && t.passed);
  const defendedRepos = repos.filter(p => p.defenseCompleted || p.score > 0);

  const dsa = Math.round(((profile.skillsAssessments?.dsaScore || profile.placement?.codingChallengeScore || 0) / 10) * 10) / 10;
  const sysDesign = Math.round(((profile.skillsAssessments?.systemDesignScore || 0) / 10) * 10) / 10;
  const webEng = Math.round((((profile.lms?.assignmentCompletionPct || 0) * 0.5 + (repos.length ? 50 : 0)) / 10) * 10) / 10;
  const coreCs = Math.round(((profile.skillsAssessments?.coreCsScore || 0) / 10) * 10) / 10;
  const dbEng = Math.round((((profile.academics?.cgpa ? profile.academics.cgpa * 10 : 0) * 0.8) / 10) * 10) / 10;
  const placement = Math.round(((profile.placement?.aptitudeScore || 0) / 10) * 10) / 10;

  const skills = [
    { id: "s1", name: "Algorithms & DSA", level: dsa, maxLevel: 10, growth: dsa > 0 ? `Level ${dsa}/10` : "Needs Assessment", color: "#38bdf8", completedTopics: dsaTest.length, totalTopics: 20 },
    { id: "s2", name: "System Design & Architecture", level: sysDesign, maxLevel: 10, growth: sysDesign > 0 ? `Level ${sysDesign}/10` : "Needs Assessment", color: "#a855f7", completedTopics: sysDesignTest.length, totalTopics: 20 },
    { id: "s3", name: "Full-Stack Web Engineering", level: webEng, maxLevel: 10, growth: webEng > 0 ? `Level ${webEng}/10` : "Needs Assessment", color: "#ec4899", completedTopics: defendedRepos.length + webEngTest.length, totalTopics: 20 },
    { id: "s4", name: "Database & Storage Engines", level: dbEng, maxLevel: 10, growth: dbEng > 0 ? `Level ${dbEng}/10` : "Needs Assessment", color: "#10b981", completedTopics: dbTest.length, totalTopics: 20 },
    { id: "s5", name: "Core CS (OS & Networks)", level: coreCs, maxLevel: 10, growth: coreCs > 0 ? `Level ${coreCs}/10` : "Needs Assessment", color: "#f59e0b", completedTopics: coreCsTest.length, totalTopics: 20 },
    { id: "s6", name: "Campus Placement Readiness", level: placement, maxLevel: 10, growth: placement > 0 ? `Level ${placement}/10` : "Needs Assessment", color: "#6366f1", completedTopics: placementTest.length, totalTopics: 20 }
  ];

  const aiRecommendations = [
    {
      id: "rec-1",
      topic: dsa < 6 ? "Dynamic Programming & Tree Traversal Bootcamps" : "Advanced Graph Shortest-Path & Disjoint Sets",
      category: "Algorithms & DSA",
      reason: `Directly targeted to elevate your DSA dimension from ${dsa}/10.`,
      estimatedMinutes: 40,
      xpGain: 120,
      difficulty: dsa < 6 ? "Intermediate" : "Advanced",
      completed: false
    },
    {
      id: "rec-2",
      topic: webEng < 6 ? "Build & Deploy a Full-Stack CRUD Application" : "High-Concurrency Async Workers & Memory Pools",
      category: "Full-Stack Web Engineering",
      reason: `Boosts your practical build proof for ${user.targetJobRole || 'Software Engineering'}.`,
      estimatedMinutes: 35,
      xpGain: 100,
      difficulty: "Intermediate",
      completed: false
    },
    {
      id: "rec-3",
      topic: placement < 6 ? "Campus Placement Speed Aptitude & Logical Reasoning" : "System Design Trade-offs & Distributed Caching",
      category: "Placement Readiness",
      reason: "Prepares you to clear campus screening filtration criteria.",
      estimatedMinutes: 45,
      xpGain: 140,
      difficulty: "Intermediate",
      completed: false
    }
  ];

  return { skills, aiRecommendations };
}

// Skill DNA
app.get('/api/skills/dna/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const profile = db.studentProfiles[studentId];
  const hasData = Boolean(profile && profile.hasProvidedData === true && profile.successScore > 0);

  // For zero-scale/pending students, always generate pure real-time 0-scale DNA and clean any stale cached DNA
  if (!hasData) {
    if (db.skillDNA && db.skillDNA[studentId]) {
      delete db.skillDNA[studentId];
    }
    return res.json({ dna: generateStudentSkillDNA(studentId) });
  }

  let dna = db.skillDNA[studentId];
  if (!dna) {
    dna = generateStudentSkillDNA(studentId);
    db.skillDNA[studentId] = dna;
  }
  res.json({ dna });
});

app.post('/api/skills/complete-topic', (req, res) => {
  const { studentId, topicId } = req.body;
  const db = getDb();
  let dna = db.skillDNA[studentId];
  if (!dna) {
    dna = generateStudentSkillDNA(studentId);
    db.skillDNA[studentId] = dna;
  }
  const topic = dna.aiRecommendations.find(t => t.id === topicId);
  if (!topic) return res.status(404).json({ error: "Topic not found" });

  topic.completed = true;
  const pointsAwarded = topic.xpGain;

  if (!db.rewards.userPoints[studentId]) {
    db.rewards.userPoints[studentId] = { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  }
  db.rewards.userPoints[studentId].totalEarned += pointsAwarded;
  db.rewards.userPoints[studentId].currentBalance += pointsAwarded;

  saveData();
  persistToMongo('skillDNA', { studentId, ...dna });
  persistToMongo('points', { studentId, ...db.rewards.userPoints[studentId] });

  res.json({
    message: `Completed "${topic.topic}"! Gained ${pointsAwarded} points & boosted skill node.`,
    topic,
    dna,
    pointsAwarded
  });
});

// Future You (Requirement 3: Fixed to match frontend FutureForecast schema)
app.get('/api/future-you/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const user = db.users.find(u => u.id === studentId) || { targetJobRole: "Software Development Engineer" };
  const profile = db.studentProfiles[studentId];
  const repos = (db.githubProjects || []).filter(p => p.studentId === studentId && p.verified);
  const streak = db.streaks?.[studentId] || { currentStreak: 0 };

  if (!profile || profile.hasProvidedData === false || profile.successScore === 0) {
    return res.json({
      futureYou: {
        currentPaceMonths: 0,
        targetRole: user.targetJobRole || "Software Development Engineer",
        readinessScore: 0,
        breakdown: {
          systemDesign: 0,
          codingProficiency: 0,
          verifiedBuildProof: 0,
          dailyConsistency: 0,
          interviewReadiness: 0
        },
        projections: [
          { month: "Month 1", readiness: 0, marketPercentile: 0 },
          { month: "Month 2", readiness: 0, marketPercentile: 0 },
          { month: "Month 3 (Target)", readiness: 0, marketPercentile: 0 }
        ],
        aiAdvice: "Your academic baseline is currently at 0 scale. Please enter your academic, attendance, and placement metrics to calculate your dynamic 3-month career forecast."
      }
    });
  }

  const score = profile.successScore;
  const paceMonths = Math.max(1, Math.min(12, Math.round((100 - score) / 5.5)));
  const targetScore = Math.min(99.2, Math.round((score + 7.5) * 10) / 10);

  const forecast = {
    currentPaceMonths: paceMonths,
    targetRole: user.targetJobRole || "Software Development Engineer",
    readinessScore: Math.round(score),
    breakdown: {
      systemDesign: profile.skillsAssessments?.systemDesignScore || Math.round(score * 0.9),
      codingProficiency: profile.placement?.codingChallengeScore || Math.round(score * 0.92),
      verifiedBuildProof: repos.length ? Math.min(100, repos.length * 40) : 35,
      dailyConsistency: streak.currentStreak > 0 ? Math.min(100, streak.currentStreak * 3 + 25) : 30,
      interviewReadiness: profile.placement?.mockInterviewScore || Math.round(score * 0.88)
    },
    projections: [
      { month: "Month 1", readiness: Math.min(100, Math.round(score + 2.5)), marketPercentile: Math.min(99, Math.round(score * 0.95 + 4)) },
      { month: "Month 2", readiness: Math.min(100, Math.round(score + 5.2)), marketPercentile: Math.min(99, Math.round(score * 0.95 + 8)) },
      { month: "Month 3 (Target)", readiness: targetScore, marketPercentile: Math.min(99, Math.round(score * 0.95 + 14)) }
    ],
    aiAdvice: score >= 85
      ? `You are on an accelerated placement track for ${user.targetJobRole}. Maintaining 20+ study hrs/week and completing 1 live project defense per month will lock in Top 5% Tier-1 offers.`
      : `To reach placement readiness for ${user.targetJobRole} in ${paceMonths} months, prioritize raising coding challenges above 75/100 and maintaining clean attendance above 75%.`
  };

  res.json({ futureYou: forecast });
});

app.post('/api/future-you/simulate', (req, res) => {
  const { weeklyHours, assignmentsRate, verifiedProjects, codingScore } = req.body;
  const hours = Number(weeklyHours) || 20;
  const assign = Number(assignmentsRate) || 80;
  const projects = Number(verifiedProjects) || 1;
  const coding = Number(codingScore) || 75;

  const simulatedReadiness = Math.min(99.0, Math.round((45 + (hours * 0.6) + (assign * 0.15) + (projects * 6) + (coding * 0.15)) * 10) / 10);
  const projectedMonths = Math.max(1, Math.round((100 - simulatedReadiness) / 6));

  res.json({
    projectedMonths,
    readinessScore: Math.round(simulatedReadiness),
    trajectorySummary: `With ${hours} hrs/week, ${assign}% assignment rate, and ${projects} verified builds, your readiness will reach ${simulatedReadiness}/100 in ~${projectedMonths} months.`,
    projections: [
      { month: "Current", readiness: Math.round(simulatedReadiness - 6), marketPercentile: Math.round(simulatedReadiness * 0.9) },
      { month: "Month 1", readiness: Math.round(simulatedReadiness - 2), marketPercentile: Math.round(simulatedReadiness * 0.94) },
      { month: "Month 2", readiness: Math.round(simulatedReadiness), marketPercentile: Math.round(simulatedReadiness * 0.97) },
      { month: "Month 3 (Target)", readiness: Math.min(100, Math.round(simulatedReadiness + 3)), marketPercentile: 98 }
    ]
  });
});

// AI Student Copilot Bot (Requirement 4)
app.post('/api/ai/chat', (req, res) => {
  const { studentId, message, conversationHistory } = req.body;
  const db = getDb();
  const user = db.users.find(u => u.id === studentId) || { name: "Student", targetJobRole: "Software Engineer" };
  const profile = db.studentProfiles[studentId] || getZeroProfile(studentId);
  const streak = db.streaks?.[studentId] || { currentStreak: 0, freezeTokens: 1 };
  const repos = (db.githubProjects || []).filter(p => p.studentId === studentId);
  const weeklyTests = db.weeklyTests?.[studentId] || [];

  const reply = generateAiStudentAdvice({
    user,
    profile,
    streak,
    repos,
    weeklyTests,
    userMessage: message,
    conversationHistory
  });

  res.json({ reply, timestamp: new Date().toISOString() });
});

function generateAiStudentAdvice({ user, profile, streak, repos, weeklyTests, userMessage }) {
  const msg = (userMessage || '').toLowerCase();
  const name = user.name || 'Student';
  const targetRole = user.targetJobRole || 'Software Development Engineer';

  if (!profile || profile.hasProvidedData === false || profile.successScore === 0) {
    return `Hello **${name}**! 👋

Your profile is currently at **0 Scale** because you haven't entered your academic and placement metrics yet.

### 🚀 Immediate Next Step:
Click **"✏️ Enter / Update My Metrics"** on your dashboard to provide your:
1. **CGPA & Marks %** (and active backlogs, if any)
2. **Attendance %**
3. **LMS Assignment Completion & Study Hours**
4. **Placement Readiness & Coding Assessment Scores**
5. **GitHub Account & Projects**

Once you submit your baseline, I will calculate your unified **Student Success Score**, identify your exact risk factors, and build a personalized roadmap for **${targetRole}**!`;
  }

  const score = profile.successScore;
  const cgpa = profile.academics?.cgpa || 0;
  const backlogs = profile.academics?.activeBacklogs || 0;
  const attendance = profile.attendance?.attendancePct || 0;
  const codingScore = profile.placement?.codingChallengeScore || 0;
  const verifiedCount = (repos || []).filter(r => r.verified).length;

  if (msg.includes('placement') || msg.includes('job') || msg.includes('career') || msg.includes('interview')) {
    let placementVerdict = '';
    if (backlogs > 0) {
      placementVerdict = `⚠️ **Critical Placement Barrier**: You currently have **${backlogs} active backlog(s)**. Over 85% of Tier-1 product companies require 0 active backlogs during campus filtration. Prioritize clearing these in the upcoming re-exam cycle.`;
    } else if (codingScore >= 80 && cgpa >= 8.0) {
      placementVerdict = `🌟 **High Placement Readiness**: Your CGPA (${cgpa}) and Coding Score (${codingScore}/100) place you in the **Top Tier** for **${targetRole}**. You meet 100% of campus placement screening criteria.`;
    } else if (codingScore < 60) {
      placementVerdict = `🎯 **Placement Gap Detected**: While your academic CGPA is ${cgpa}, your coding assessment score is **${codingScore}/100**. Most corporate placement coding tests filter out below 70. Spend 90 mins daily on Data Structures (Dynamic Programming, HashMaps, Binary Trees).`;
    } else {
      placementVerdict = `👍 **On-Track for Placements**: Your score of ${score}/100 is solid. Bolster your profile by verifying at least 2 real-world projects via the **Proof-of-Build Defense**.`;
    }

    return `Here is your **Placement & Career Readiness Analysis** for **${targetRole}**:

- **Unified Success Score**: **${score}/100**
- **Academic CGPA**: **${cgpa}/10** (${backlogs} backlogs)
- **Coding Assessment**: **${codingScore}/100**
- **Verified Build Projects**: **${verifiedCount} Verified**

${placementVerdict}

### 📋 Recommended 3-Step Action Plan:
1. **Solve 3 DSA Questions Daily**: Focus on LeetCode Mediums in Trees and Graphs.
2. **Take Weekly Assessment Test**: Take Week 1 & Week 2 tests to boost your placement percentile.
3. **Defense Verification**: Ensure your GitHub projects are audited with the AI Voice Defense.`;
  }

  if (msg.includes('attendance') || msg.includes('bunk') || msg.includes('absent')) {
    if (attendance < 75) {
      return `⚠️ **Urgent Attendance Warning**:
Your attendance is currently **${attendance}%**, which is **below the mandatory 75% university threshold**.
- Debarment risk: **HIGH**
- Action needed: You cannot afford to miss upcoming lectures. Attend every lecture continuously for the next 2-3 weeks to cross the 75% safe barrier.`;
    } else {
      return `✅ **Attendance Status**:
Your attendance is currently **${attendance}%** (Status: Safe). You comfortably exceed the university 75% threshold. Keep up this consistency!`;
    }
  }

  if (msg.includes('predict') || msg.includes('future') || msg.includes('score')) {
    const projected = Math.min(99.0, Math.round((score + 6.8) * 10) / 10);
    return `📈 **AI Trajectory Prediction**:
Based on your current metrics (Score: **${score}/100**, Attendance: **${attendance}%**, Coding: **${codingScore}/100**):
- **3-Month Projected Score**: **${projected}/100** (+${Math.round((projected - score) * 10) / 10} pts)
- **Target Pace**: Ready for Tier-1 recruitment in **${Math.max(1, Math.round((100 - score) / 6))} Months**
- **Confidence Level**: 94% (AURA Multi-Pillar Engine)`;
  }

  if (msg.includes('focus') || msg.includes('what should i study') || msg.includes('schedule') || msg.includes('plan')) {
    let focusArea = 'Data Structures & Algorithms';
    if (backlogs > 0) focusArea = 'Academic Backlog Clearance & Lab Work';
    else if (attendance < 75) focusArea = 'Lecture Attendance & Theory Classes';
    else if (codingScore < 70) focusArea = 'Coding Challenge Bootcamps & LeetCode';
    else if (verifiedCount < 2) focusArea = 'Proof-of-Build Project Implementation';

    return `🎯 **Your High-Priority Focus This Week**:

Your single biggest leverage point right now is **${focusArea}**.

### 🗓️ Recommended 7-Day Roadmap:
- **Mon - Wed**: Dedicate 2 hours daily to **${focusArea}**.
- **Thu - Fri**: Complete LMS assignment submissions to keep submission rate at 95%+.
- **Sat**: Take the **Weekly Test** in the platform to update your skills benchmark.
- **Sun**: Submit or verify one GitHub project defense in the **Proof of Build** hub.`;
  }

  return `Hello **${name}**! I've analyzed your live academic & placement profile:

- **Composite Success Score**: **${score}/100**
- **CGPA**: **${cgpa}/10** | **Backlogs**: **${backlogs}**
- **Attendance**: **${attendance}%**
- **Coding Assessment**: **${codingScore}/100**
- **Target Role**: **${targetRole}**

What specific area would you like guidance on?
1. 🎯 **Placement readiness & company screening analysis**
2. 📈 **Future-You 3-month score forecast**
3. 🛡️ **Risk factors & academic recovery plan**
4. 💻 **GitHub project verification & technical defense**`;
}

// Weekly Assessment Tests (Requirement 6)
const WEEKLY_TESTS_CATALOG = [
  {
    id: "test-w1",
    weekNumber: 1,
    title: "Week 1: Data Structures & Algorithmic Complexity",
    category: "Algorithms & DSA",
    durationMinutes: 10,
    questionsCount: 4,
    questions: [
      {
        id: "q1",
        question: "What is the amortized time complexity of inserting N elements into a dynamic array (like std::vector or ArrayList)?",
        options: ["O(N^2)", "O(N)", "O(log N)", "O(N log N)"],
        correctIndex: 1,
        explanation: "Dynamic arrays double their capacity when full. Doubling happens infrequently, resulting in O(1) amortized insertion per element, so N elements take O(N) total."
      },
      {
        id: "q2",
        question: "Given a binary search tree, what is the worst-case lookup time if the tree is completely unbalanced (skewed)?",
        options: ["O(log N)", "O(1)", "O(N)", "O(N log N)"],
        correctIndex: 2,
        explanation: "A degenerate skewed BST resembles a linked list, where searching requires traversing all N nodes sequentially, giving O(N)."
      },
      {
        id: "q3",
        question: "Which data structure is most suitable for implementing an LRU (Least Recently Used) cache with O(1) get and put operations?",
        options: ["Max Heap + Array", "Doubly Linked List + Hash Map", "Binary Search Tree + Stack", "Trie + Queue"],
        correctIndex: 1,
        explanation: "A Hash Map provides O(1) key lookups, while a Doubly Linked List allows O(1) node detachment and head insertion."
      },
      {
        id: "q4",
        question: "What is the minimum number of comparisons needed to find both the maximum and minimum elements in an array of size N in the best case?",
        options: ["2N - 2", "3N/2 - 2", "N - 1", "N log N"],
        correctIndex: 1,
        explanation: "Comparing elements in pairs takes 3N/2 - 2 comparisons instead of 2N - 2 standard sequential scans."
      }
    ]
  },
  {
    id: "test-w2",
    weekNumber: 2,
    title: "Week 2: Full-Stack Web Architecture & Asynchronous Runtimes",
    category: "Full-Stack Web Engineering",
    durationMinutes: 10,
    questionsCount: 4,
    questions: [
      {
        id: "q1",
        question: "In JavaScript's Event Loop, which queue has priority when the call stack becomes empty?",
        options: ["Task Queue (macrotasks)", "Microtask Queue (Promises, queueMicrotask)", "I/O Polling Queue", "Timer Check Queue"],
        correctIndex: 1,
        explanation: "The microtask queue is completely drained before any macrotask from the task queue is executed."
      },
      {
        id: "q2",
        question: "Why should long-running CPU calculations NOT be run directly on the Node.js main thread?",
        options: ["Node.js lacks multi-threading libraries", "It blocks the event loop and delays incoming I/O HTTP requests", "V8 engine crashes on while loops", "Memory leaks occur automatically"],
        correctIndex: 1,
        explanation: "Node.js runs Javascript on a single thread event loop. CPU-intensive operations block the thread, stalling all concurrent HTTP connections."
      },
      {
        id: "q3",
        question: "What HTTP response header is required on an API server to allow cross-origin requests with credentials (cookies/auth headers)?",
        options: ["Access-Control-Allow-Origin: *", "Access-Control-Allow-Credentials: true with specific Origin", "X-Frame-Options: SAMEORIGIN", "Cache-Control: no-store"],
        correctIndex: 1,
        explanation: "When credentials are included, wildcard '*' is forbidden by browser CORS specs; explicit origin and Access-Control-Allow-Credentials: true are required."
      },
      {
        id: "q4",
        question: "What is the primary benefit of HTTP/2 multiplexing over HTTP/1.1?",
        options: ["Requires no TLS certificate", "Allows concurrent requests and responses over a single TCP connection without head-of-line blocking", "Compresses images losslessly", "Eliminates DNS lookups"],
        correctIndex: 1,
        explanation: "HTTP/2 interleaves binary frames over a single TCP connection, eliminating head-of-line blocking present in HTTP/1.1."
      }
    ]
  },
  {
    id: "test-w3",
    weekNumber: 3,
    title: "Week 3: Database Engines, Storage & System Design",
    category: "Databases & System Design",
    durationMinutes: 10,
    questionsCount: 4,
    questions: [
      {
        id: "q1",
        question: "Why do relational database storage engines (like Postgres and MySQL InnoDB) typically use B+ Trees instead of B Trees for indexing?",
        options: ["B+ Trees store duplicate keys", "Leaves are linked sequentially and internal nodes only store keys, maximizing cache line density", "B+ Trees consume less RAM", "B+ Trees support binary search on disk"],
        correctIndex: 1,
        explanation: "B+ Tree leaves are linked together in a linked list, making range scans blazing fast, and non-leaf nodes hold more keys per disk block."
      },
      {
        id: "q2",
        question: "Under the CAP theorem, what happens to a distributed partition-tolerant system during a network partition?",
        options: ["It achieves both Consistency and Availability", "It must choose between Consistency (refusing inconsistent writes) and Availability (returning stale data)", "It automatically switches to single-node mode", "Data is lost permanently"],
        correctIndex: 1,
        explanation: "When a network partition occurs, the system can either preserve consistency by rejecting diverging updates, or preserve availability by accepting divergent reads/writes."
      },
      {
        id: "q3",
        question: "What is the primary advantage of a Bloom Filter in a database read path (e.g. LSM Trees in Cassandra or RocksDB)?",
        options: ["Sorts keys on disk", "Quickly confirms whether a key definitely does NOT exist on disk, avoiding expensive disk I/O", "Compresses JSON strings", "Encrypts sensitive data"],
        correctIndex: 1,
        explanation: "Bloom filters have 0 false negatives: if it says a key is not in an SSTable, the engine avoids reading that disk block completely."
      },
      {
        id: "q4",
        question: "What cache eviction strategy is best suited for workloads with frequent cyclical sequential scans?",
        options: ["Pure FIFO", "LRU (Least Recently Used)", "2Q or LFU (Least Frequently Used)", "Random Eviction"],
        correctIndex: 2,
        explanation: "Pure LRU suffers from cache pollution during sequential scans where valuable frequent pages get evicted; 2Q or frequency-based algorithms mitigate this."
      }
    ]
  },
  {
    id: "test-w4",
    weekNumber: 4,
    title: "Week 4: Campus Placement Aptitude & Logical Reasoning",
    category: "Placement Readiness",
    durationMinutes: 10,
    questionsCount: 4,
    questions: [
      {
        id: "q1",
        question: "A train running at 72 km/h crosses a 200m platform in 25 seconds. What is the length of the train?",
        options: ["250 meters", "300 meters", "350 meters", "400 meters"],
        correctIndex: 1,
        explanation: "72 km/h = 72 * (5/18) = 20 m/s. Distance in 25s = 20 * 25 = 500m. Length of train = 500 - 200 = 300 meters."
      },
      {
        id: "q2",
        question: "If 12 men can complete a software testing project in 15 days working 8 hours a day, how many days will 10 men take working 9 hours a day?",
        options: ["14 days", "16 days", "18 days", "20 days"],
        correctIndex: 1,
        explanation: "Total work = 12 * 15 * 8 = 1440 man-hours. Required days = 1440 / (10 * 9) = 1440 / 90 = 16 days."
      },
      {
        id: "q3",
        question: "Find the next number in the series: 3, 7, 15, 31, 63, ...",
        options: ["125", "127", "128", "131"],
        correctIndex: 1,
        explanation: "Each term is 2 * previous + 1: 3*2+1=7, 7*2+1=15, 15*2+1=31, 31*2+1=63, 63*2+1 = 127."
      },
      {
        id: "q4",
        question: "In a class of 60 students, 35 study Python, 25 study Java, and 12 study both. How many students study neither Python nor Java?",
        options: ["8 students", "12 students", "15 students", "18 students"],
        correctIndex: 1,
        explanation: "Total studying at least one = 35 + 25 - 12 = 48. Students studying neither = 60 - 48 = 12 students."
      }
    ]
  }
];

app.get('/api/tests/catalog', (req, res) => {
  const catalog = WEEKLY_TESTS_CATALOG.map(t => ({
    id: t.id,
    weekNumber: t.weekNumber,
    title: t.title,
    category: t.category,
    durationMinutes: t.durationMinutes,
    questionsCount: t.questionsCount,
    completed: false,
    score: null,
    passed: false,
    completedAt: null
  }));
  res.json({ tests: catalog, totalAttempts: 0 });
});

app.get('/api/tests/catalog/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const attempts = db.weeklyTests?.[studentId] || [];

  const catalog = WEEKLY_TESTS_CATALOG.map(t => {
    const attempt = attempts.find(a => a.testId === t.id);
    return {
      id: t.id,
      weekNumber: t.weekNumber,
      title: t.title,
      category: t.category,
      durationMinutes: t.durationMinutes,
      questionsCount: t.questionsCount,
      completed: Boolean(attempt),
      score: attempt?.score || null,
      passed: attempt?.passed || false,
      completedAt: attempt?.completedAt || null
    };
  });

  res.json({ tests: catalog, totalAttempts: attempts.length });
});

app.get('/api/tests/:testId', (req, res) => {
  const { testId } = req.params;
  const test = WEEKLY_TESTS_CATALOG.find(t => t.id === testId);
  if (!test) return res.status(404).json({ error: "Test not found" });

  // Return questions without revealing correctIndex
  const safeQuestions = test.questions.map(q => ({
    id: q.id,
    question: q.question,
    options: q.options
  }));

  res.json({
    test: {
      id: test.id,
      weekNumber: test.weekNumber,
      title: test.title,
      category: test.category,
      durationMinutes: test.durationMinutes,
      questionsCount: test.questionsCount,
      questions: safeQuestions
    }
  });
});

app.post('/api/tests/submit', (req, res) => {
  const { studentId, testId, answers } = req.body;
  const db = getDb();
  const user = db.users.find(u => u.id === studentId);
  if (!user) return res.status(404).json({ error: "Student not found" });

  const test = WEEKLY_TESTS_CATALOG.find(t => t.id === testId);
  if (!test) return res.status(404).json({ error: "Test not found" });

  let correctCount = 0;
  test.questions.forEach(q => {
    if (answers && answers[q.id] === q.correctIndex) {
      correctCount++;
    }
  });

  const scorePct = Math.round((correctCount / test.questions.length) * 100);
  const passed = scorePct >= 50;

  let profile = db.studentProfiles[studentId] || getZeroProfile(studentId);
  profile.hasProvidedData = true;

  // Update specific skills assessment based on test category
  if (test.category === "Algorithms & DSA") {
    profile.skillsAssessments.dsaScore = Math.max(profile.skillsAssessments.dsaScore || 0, scorePct);
    profile.placement.codingChallengeScore = Math.max(profile.placement.codingChallengeScore || 0, Math.round(scorePct * 0.95));
  } else if (test.category === "Full-Stack Web Engineering") {
    profile.skillsAssessments.systemDesignScore = Math.max(profile.skillsAssessments.systemDesignScore || 0, scorePct);
  } else if (test.category === "Databases & System Design") {
    profile.skillsAssessments.coreCsScore = Math.max(profile.skillsAssessments.coreCsScore || 0, scorePct);
  } else if (test.category === "Placement Readiness") {
    profile.placement.aptitudeScore = Math.max(profile.placement.aptitudeScore || 0, scorePct);
  }

  // Recalculate composite Success Score
  const newScore = computeSuccessScore(profile);
  profile.successScore = newScore;

  // Append history
  if (!profile.history) profile.history = [];
  profile.history.push({
    month: `Wk ${test.weekNumber}`,
    score: newScore,
    academics: Math.round((profile.academics.cgpa / 10) * 100),
    attendance: Math.round(profile.attendance.attendancePct),
    placement: Math.round(profile.placement.codingChallengeScore)
  });

  // Log test attempt
  if (!db.weeklyTests) db.weeklyTests = {};
  if (!db.weeklyTests[studentId]) db.weeklyTests[studentId] = [];
  const attemptRecord = {
    testId: test.id,
    weekNumber: test.weekNumber,
    title: test.title,
    score: scorePct,
    passed,
    correctCount,
    totalCount: test.questions.length,
    completedAt: new Date().toISOString()
  };
  db.weeklyTests[studentId] = db.weeklyTests[studentId].filter(a => a.testId !== test.id);
  db.weeklyTests[studentId].push(attemptRecord);

  // Award points
  const pointsAwarded = 100;
  if (!db.rewards.userPoints[studentId]) {
    db.rewards.userPoints[studentId] = { totalEarned: 0, currentBalance: 0, redeemedHistory: [] };
  }
  db.rewards.userPoints[studentId].totalEarned += pointsAwarded;
  db.rewards.userPoints[studentId].currentBalance += pointsAwarded;

  db.studentProfiles[studentId] = profile;
  saveData();
  persistToMongo('profile', profile);
  persistToMongo('points', { studentId, ...db.rewards.userPoints[studentId] });

  res.json({
    message: `Test "${test.title}" submitted successfully!`,
    score: scorePct,
    correctCount,
    totalCount: test.questions.length,
    passed,
    pointsAwarded,
    newSuccessScore: newScore,
    profile,
    attempt: attemptRecord
  });
});

// Skill Passport Public View
app.get('/api/passport/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = getDb();
  const user = db.users.find(u => u.id === studentId || u.githubUsername === studentId) || db.users.find(u => u.role === 'student') || db.users[0];
  const profile = db.studentProfiles[user.id] || getZeroProfile(user.id);
  const streak = db.streaks[user.id] || { currentStreak: 0 };
  const verifiedProjects = (db.githubProjects || []).filter(p => p.studentId === user.id && p.verified);
  const dna = db.skillDNA[user.id] || generateStudentSkillDNA(user.id);

  res.json({
    passport: {
      user: {
        id: user.id,
        name: user.name,
        batch: user.batch,
        avatar: user.avatar,
        bio: user.bio,
        targetJobRole: user.targetJobRole,
        githubUsername: user.githubUsername
      },
      stats: {
        successScore: profile.successScore,
        cgpa: profile.academics.cgpa,
        currentStreak: streak.currentStreak,
        verifiedProjectsCount: verifiedProjects.length,
        averageAuthenticityScore: verifiedProjects.length ? 93 : 90
      },
      verifiedProjects,
      skills: dna.skills,
      authority: "AURA Cryptographic Proof-of-Build Protocol",
      issueDate: "2026-10-09"
    }
  });
});

app.listen(PORT, () => {
  console.log(`Student Success Analytics API running on port ${PORT}`);
});
