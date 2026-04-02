import express from "express";
import {
  getCurrentUser,
  getGoogleAuthConfig,
  getPendingUsers,
  getUsers,
  googleLogin,
  updateUserByAdmin,
} from "../controllers/authController.js";
import { authenticateRequest, requireApprovedUser, requireRoles } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/google/config", getGoogleAuthConfig);
router.post("/google", googleLogin);
router.get("/me", authenticateRequest, requireApprovedUser, getCurrentUser);

router.get("/users", authenticateRequest, requireApprovedUser, requireRoles("admin"), getUsers);
router.get(
  "/users/pending",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("admin"),
  getPendingUsers,
);
router.patch(
  "/users/:userId",
  authenticateRequest,
  requireApprovedUser,
  requireRoles("admin"),
  updateUserByAdmin,
);

export default router;
