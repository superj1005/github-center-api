import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import "dotenv/config.js";

import { clerkMiddleware, requireAuth, getAuth } from "@clerk/express";

import userWebhook from "./webhooks/user.webhook.js"; 

import repoRouter from "./routes/repo.route.js";
import patRouter from "./routes/pat.route.js";
import userRouter from "./routes/user.route.js";
import ghRouter from "./routes/gh.route.js";
import groupRouter from "./routes/group.route.js";
import prRouter from "./routes/pr.route.js";

const app = express();
const corsOptions = {
  origin: ["https://githubcenter.vercel.app", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true, // Important for cookies/sessions
  allowedHeaders: [
    "Content-Type", 
    "Authorization", 
    "Origin", 
    "X-Requested-With", 
    "Accept"
  ],
};

app.use(cors(corsOptions));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`  ${req.method} ${req.path} -> [${new Date().toISOString()}]`);
  // console.log('   Headers:', req.headers);
  console.log('  Query:', req.query);
  // console.log('   Body:', req.body);
  console.log('----------------------------------------');
  next(); // Don't forget to call next() to continue to the next middleware
});
 
// Clerk Middleware (attaches auth to req.auth)
app.use(clerkMiddleware()); 

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) {
    console.log("✅ Reusing existing MongoDB connection");
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = await mongoose.connect(MONGO_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 15000,
    });
  } 

  try {
    cached.conn = await cached.promise;
    console.log("✅ New MongoDB connection established");
    return cached.conn;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    throw err;
  }
}

await connectToDatabase();

// Public route
app.get("/api/public", (req, res) => {
  res.json({ message: "This is a public route" });
});

// Protected route (middleware at route level)
app.get("/api/protected", requireAuth(), (req, res) => {
  const { userId } = getAuth(req);
  res.json({ message: `Hello user ${userId}, this is protected.` });
});


// Routes ->
app.use("/api/repo", repoRouter);
app.use("/api/pat", patRouter);
app.use("/api/users", userRouter);
app.use("/api/gh", ghRouter);
app.use("/api/group", groupRouter);
app.use("/api/pr", prRouter);

// Webhook routes ->
app.use("/webhook/users", userWebhook);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// ngrok http --url=spider-star-wasp.ngrok-free.app 5000
// https://spider-star-wasp.ngrok-free.app

//you have to add that above url  in the webhook section of the clerk