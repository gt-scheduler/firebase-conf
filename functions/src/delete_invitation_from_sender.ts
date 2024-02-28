import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import { FriendData, FriendInviteData } from "../utils/types";

const firestore = admin.firestore();
const auth = admin.auth();

const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

const friendsCollection = firestore.collection(
  "friends"
) as FirebaseFirestore.CollectionReference<FriendData>;

const corsHandler = cors({ origin: true });

export const deleteInvitationFromSender = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        try {
          // This request should be made with content type is application/x-www-form-urlencoded.
          // This is done to prevent a pre-flight CORS request made to the firebase function
          // Refer: https://github.com/gt-scheduler/website/pull/187#issuecomment-1496439246
          request.body = JSON.parse(request.body.data);
        } catch {
          response.status(401).json(apiError("Bad request"));
        }
        const { IDToken, friendId, term, version } = request.body;

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!friendId || !term || !version) {
          return response
            .status(400)
            .json(apiError("Invalid arguments provided"));
        }

        // Authenticate token id
        let decodedToken: admin.auth.DecodedIdToken;
        try {
          decodedToken = await auth.verifyIdToken(IDToken);
        } catch {
          return response.status(401).json(apiError("User not found"));
        }

        // Get user UID from the decoded token
        const senderId = decodedToken.uid;

        // find and delete existing invites for the same sender, friend, term, and version
        const existingInvites = await invitesCollection
          .where("sender", "==", senderId)
          .where("friend", "==", friendId)
          .where("term", "==", term)
          // .where("version", "==", version)
          .get();
        const batch = firestore.batch();
        existingInvites.forEach((doc) => {
          if (doc.get("link")) {
            return;
          }
          const currVersions: string[] = doc.get("versions");
          const newVersions = currVersions.filter((v) => v !== version);
          if (newVersions.length === 0) {
            batch.delete(doc.ref);
          } else if (newVersions.length !== currVersions.length) {
            batch.update(doc.ref, { versions: newVersions });
          }
        });
        await batch.commit();

        const friendData = (await friendsCollection.doc(friendId).get()).data();
        if (
          friendData?.terms &&
          friendData.terms[term]?.accessibleSchedules &&
          friendData.terms[term].accessibleSchedules[senderId]
        ) {
          const accessibleSchedules =
            friendData.terms[term].accessibleSchedules;
          accessibleSchedules[senderId] = accessibleSchedules[senderId].filter(
            (version_) => version !== version_
          );
          if (accessibleSchedules[senderId].length === 0) {
            delete accessibleSchedules[senderId];
          }
          await friendsCollection.doc(friendId).set(friendData);
        }
        return response.status(204).json({ message: "Deleted successfully" });
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  }
);
