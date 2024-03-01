import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  FriendData,
  FriendInviteData,
  AnyScheduleData,
  Version3ScheduleData,
  ScheduleDeletionRequest,
} from "../utils/types";

const firestore = admin.firestore();
const auth = admin.auth();

const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

const friendsCollection = firestore.collection(
  "friends"
) as FirebaseFirestore.CollectionReference<FriendData>;

const corsHandler = cors({ origin: true });

export const deleteSharedSchedule = functions.https.onRequest(
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

        const {
          IDToken,
          otherUserId,
          term,
          versions: versionsTemp,
          owner,
        }: ScheduleDeletionRequest = request.body;

        const versions = Array.isArray(versionsTemp)
          ? versionsTemp
          : [versionsTemp];

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!otherUserId || !term || !versions) {
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
        const requesterId = decodedToken.uid;

        const senderId = owner ? requesterId : otherUserId;
        const friendId = owner ? otherUserId : requesterId;

        const existingInvites = await invitesCollection
          .where("sender", "==", senderId)
          .where("friend", "==", friendId)
          .where("term", "==", term)
          // .where("version", "==", version)
          .get();

        const scheduleResponse = await schedulesCollection.doc(senderId).get();
        const scheduleData: Version3ScheduleData | undefined =
          scheduleResponse.data() as Version3ScheduleData | undefined;

        const friendData = (await friendsCollection.doc(friendId).get()).data();
        const accessibleSchedules =
          friendData?.terms?.[term]?.accessibleSchedules;

        // find and delete existing invites for the same sender, friend, term, and version
        // also deletes friend invites that show up on the sender's invitation modal
        await Promise.allSettled(
          versions.map(async (version) => {
            try {
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

              delete scheduleData?.terms[term]?.versions[version]?.friends?.[
                friendId
              ];

              if (accessibleSchedules?.[senderId]) {
                accessibleSchedules[senderId] = accessibleSchedules[
                  senderId
                ].filter((v) => v !== version);
                if (accessibleSchedules[senderId].length === 0) {
                  delete accessibleSchedules[senderId];
                }
              }
            } catch {
              // pass
            }
          })
        );

        if (scheduleData) {
          await schedulesCollection.doc(senderId).set(scheduleData);
        }

        if (friendData) {
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
