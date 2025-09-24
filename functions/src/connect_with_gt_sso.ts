import * as functions from "firebase-functions";
import admin from "./firebase";
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import { apiError } from "./api";
import * as crypto from "crypto";

// GT SSO CAS configuration
const CAS_BASE = "https://login.gatech.edu/cas";
const CAS_LOGIN = `${CAS_BASE}/login`;
const CAS_VALIDATE = `${CAS_BASE}/serviceValidate`;

interface CasResponse {
  serviceResponse: {
    authenticationSuccess?: {
      user: string;
      attributes?: {
        [key: string]: string | string[];
      };
    };
    authenticationFailure?: {
      _: string;
    };
  };
}

// Firestore state collection (typed) for one-time CAS states
type SsoState = {
  uid: string;
  expiresAt: FirebaseFirestore.Timestamp;
};

const firestore = admin.firestore();
const ssoStatesCollection = firestore.collection(
  "sso-states"
) as FirebaseFirestore.CollectionReference<SsoState>;

/**
 * Extracts and verifies Firebase authentication from request
 * @param {functions.Request} req - Firebase Functions request object
 * @throws {Error} if authentication fails
 */
async function getAuthenticatedUser(
  req: functions.Request
): Promise<{ uid: string; decodedToken: admin.auth.DecodedIdToken }> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("User authentication required");
  }

  const idToken = authHeader.split("Bearer ")[1];
  const decodedToken = await admin.auth().verifyIdToken(idToken);

  return { uid: decodedToken.uid, decodedToken };
}

/**
 * GT SSO Login endpoint - redirects user to GT CAS login
 * Requires Firebase authentication
 */
const ssoLogin = functions
  .region("us-east1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json(apiError("Method not allowed"));
      return;
    }

    try {
      // Verify Firebase authentication
      const { uid } = await getAuthenticatedUser(req);

      // Create one-time token bound to this user
      const token = crypto.randomBytes(16).toString("hex");
      await ssoStatesCollection.doc(token).set({
        uid,
        expiresAt: admin.firestore.Timestamp.fromMillis(
          Date.now() + 5 * 60 * 1000
        ),
      });

      // Generate callback URL with token for verification
      const serviceUrl = `${req.protocol}://${req.get(
        "host"
      )}/connectWithGtSso/callback?token=${token}`;

      // Redirect to GT CAS login
      const casLoginUrl = new URL(CAS_LOGIN);
      casLoginUrl.searchParams.set("service", serviceUrl);

      res.redirect(casLoginUrl.toString());
    } catch (error) {
      console.error("SSO Login error:", error);
      if (
        error instanceof Error &&
        error.message === "User authentication required"
      ) {
        res
          .status(401)
          .json(apiError("User authentication required to /sso/login"));
      } else {
        res.status(500).json(apiError("Internal server error"));
      }
    }
  });

/**
 * GT SSO Callback endpoint - validates ticket and adds claims to user
 * Requires Firebase authentication
 */
const ssoCallback = functions
  .region("us-east1")
  .https.onRequest(async (req, res) => {
    // Set CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "GET") {
      res.status(405).json(apiError("Method not allowed"));
      return;
    }

    try {
      const ticket = req.query.ticket as string;
      const token = req.query.token as string;

      if (!ticket) {
        res.status(400).json(apiError("Missing ticket"));
        return;
      }

      if (!token) {
        res.status(400).json(apiError("Missing token"));
        return;
      }

      // Look up and consume one-time token to identify initiating user
      const stateRef = ssoStatesCollection.doc(token);
      const stateSnap = await stateRef.get();
      if (!stateSnap.exists) {
        res.status(401).json(apiError("Invalid token"));
        return;
      }
      const stateData = stateSnap.data() as SsoState | undefined;
      await stateRef.delete();
      const uid = stateData?.uid;
      const expiresAtMillis = stateData?.expiresAt?.toMillis?.() ?? 0;
      if (!uid || Date.now() > expiresAtMillis) {
        res.status(401).json(apiError("Invalid or expired token"));
        return;
      }

      // Validate ticket with GT CAS
      const serviceUrl = `${req.protocol}://${req.get(
        "host"
      )}/connectWithGtSso/callback?token=${token}`;
      const validateUrl = new URL(CAS_VALIDATE);
      validateUrl.searchParams.set("service", serviceUrl);
      validateUrl.searchParams.set("ticket", ticket);

      const response = await fetch(validateUrl.toString());
      const xml = await response.text();

      // Parse CAS response
      const doc = (await parseStringPromise(xml, {
        explicitArray: false,
        tagNameProcessors: [(name: string) => name.replace(/^cas:/, "")],
      })) as CasResponse;

      const success = doc?.serviceResponse?.authenticationSuccess;
      if (!success) {
        const error =
          doc?.serviceResponse?.authenticationFailure?._ || "GT SSO fails";
        console.error("CAS authentication failed:", error);
        res.status(401).json(apiError(error));
        return;
      }

      const gtUsername = success.user;
      if (!gtUsername) {
        res.status(400).json(apiError("No username returned from GT SSO"));
        return;
      }

      // Merge custom claims and add gt_username to Firebase user
      const existingUser = await admin.auth().getUser(uid);
      const existingClaims = (existingUser.customClaims || {}) as {
        [key: string]: unknown;
      };
      await admin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        gt_username: gtUsername,
      });

      res.json({
        ok: true,
        message: "Successfully connected with GT SSO",
        gt_username: gtUsername,
      });
    } catch (error) {
      console.error("SSO Callback error:", error);
      if (
        error instanceof Error &&
        error.message === "User authentication required"
      ) {
        res
          .status(401)
          .json(apiError("User authentication required to /callback"));
      } else {
        res.status(500).json(apiError("Internal server error"));
      }
    }
  });

export const connectWithGtSso = functions
  .region("us-east1")
  .https.onRequest(async (req, res) => {
    const path = req.path;

    if (path.endsWith("/sso/login")) {
      return ssoLogin(req, res);
    } else if (path.endsWith("/callback")) {
      return ssoCallback(req, res);
    } else {
      res.status(404).json(apiError("Endpoint not found"));
    }
  });
