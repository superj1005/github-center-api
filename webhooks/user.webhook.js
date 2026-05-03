import express from "express";
import userModel from "../models/user.model.js"; 

const router = express.Router();

// Webhook called by Clerk on user creation
router.post("/create", async (req, res) => {
  try {
    const { id, email_addresses, first_name, last_name } = req.body.data;

    const existingUser = await userModel.findOne({ clerkId: id });
    if (!existingUser) {
      const newUser = new userModel({
        clerkId: id,
        email: email_addresses[0]?.email_address,
        name: `${first_name ?? ""} ${last_name ?? ""}`.trim(),
      });
      await newUser.save();
    }


    res.status(200).json({ message: "User stored in MongoDB" });
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
