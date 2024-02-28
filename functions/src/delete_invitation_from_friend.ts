import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  AnyScheduleData,
  FriendInviteData,
  Version3ScheduleData,
} from "../utils/types";

const firestore = admin.firestore();
const auth = admin.auth();

const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;

const schedulesCollection = admin
  .firestore()
  .collection(
    "schedules"
  ) as FirebaseFirestore.CollectionReference<AnyScheduleData>;

const corsHandler = cors({ origin: true });

export const deleteInvitationFromFriend = functions.https.onRequest(
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
        const { IDToken, senderId, term, versions } = request.body as {
          IDToken: string;
          senderId: string;
          term: string;
          versions: string[];
        };

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!senderId || !term || !versions) {
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
        const friendId = decodedToken.uid;

        const senderRes = await schedulesCollection.doc(senderId).get();
        const senderData: Version3ScheduleData | undefined =
          senderRes.data() as Version3ScheduleData | undefined;

        const flag = !!(
          senderData &&
          senderData.terms &&
          senderData.terms[term].versions
        );

        // find and delete existing invites for the same sender, friend, term, and version
        // also deletes friend invites that show up on the sender's invitation modal
        await Promise.allSettled(
          versions.map(async (version) => {
            try {
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
                const newVersions = currVersions.filter(
                  (v) => !versions.includes(v)
                );
                if (newVersions.length === 0) {
                  batch.delete(doc.ref);
                } else if (newVersions.length !== currVersions.length) {
                  batch.update(doc.ref, { versions: newVersions });
                }
              });
              await batch.commit();

              if (
                flag &&
                senderData.terms[term].versions[version]?.friends?.[friendId]
              ) {
                versions.forEach((version) => {
                  delete senderData.terms[term].versions[version]?.friends?.[
                    friendId
                  ];
                });
              }
            } catch {
              // pass
            }
          })
        );

        if (senderData) {
          await schedulesCollection.doc(senderId).set(senderData);
        }
        return response.status(204).json({ message: "Deleted successfully" });
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  }
);
