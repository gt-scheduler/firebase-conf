import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

import {
  AnyScheduleData,
  CreateInviteRequestData,
  FriendInviteData,
  FriendEmailInviteData,
  Version3ScheduleData,
} from "../utils/types";
import sendInvitation from "../utils/juno/sendInvitation";

const firestore = admin.firestore();
const schedulesCollection = firestore.collection(
  "schedules"
) as FirebaseFirestore.CollectionReference<AnyScheduleData>;
const invitesCollection = firestore.collection(
  "friend-invites"
) as FirebaseFirestore.CollectionReference<FriendInviteData>;
const auth = admin.auth();

const corsHandler = cors({ origin: true });

/* This endpoint is called when a user wants to send an invitation*/
export const createFriendInvitation = functions
  .region("us-east1")
  .https.onRequest(async (request, response) => {
    corsHandler(request, response, async () => {
      try {
        try {
          // This request should be made with content type is application/x-www-form-urlencoded.
          // This is done to prevent a pre-flight CORS request made to the firebase function
          // Refer: https://github.com/gt-scheduler/website/pull/187#issuecomment-1496439246
          request.body = JSON.parse(request.body.data);
        } catch (e) {
          return response.status(401).json(apiError("Bad request"));
        }
        const { IDToken, term, versions, redirectURL, friendEmail } =
          request.body as CreateInviteRequestData;

        if (!IDToken) {
          return response.status(401).json(apiError("IDToken not provided"));
        }
        if (!friendEmail || !term || !versions || !redirectURL) {
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

        const senderEmail = decodedToken.email;

        if (!senderEmail) {
          return response
            .status(400)
            .json(apiError("Cannot invite friend without an email"));
        }

        // Check if the user is sending an invite to themself
        if (senderEmail === friendEmail) {
          return response
            .status(400)
            .json(apiError("Cannot invite self to schedule"));
        }

        // Get Sender UID from the decoded token
        const senderId = decodedToken.uid;

        // Get Sender record from the schedules collection - it has to be version 3 because an invite was sent from it
        const senderRes = await schedulesCollection.doc(senderId).get();
        const senderData: Version3ScheduleData | undefined =
          senderRes.data() as Version3ScheduleData | undefined;

        if (
          !senderData ||
          !senderData?.terms ||
          !senderData.terms[term]?.versions ||
          versions.filter((v) => !senderData.terms[term].versions[v]).length > 0
        ) {
          return response
            .status(400)
            .json(apiError("Cannot invite friend to invalid schedule version"));
        }

        const versionNames = versions.map(
          (v) => senderData.terms[term].versions[v].name
        );

        // Get friend UID if exists from friendEmail
        let friendId: string;
        try {
          const friendData = await auth.getUserByEmail(friendEmail);
          friendId = friendData.uid;
        } catch {
          return response
            .status(400)
            .json(apiError("Email does not exist in database"));
        }

        const sortedVersions = versions.sort();

        // find and delete existing invites for the same sender, friend, term, and version
        const existingInvites = await invitesCollection
          .where("sender", "==", senderId)
          .where("friend", "==", friendId)
          .where("term", "==", term)
          .where("versions", "==", sortedVersions)
          .where("link", "==", false)
          .get();
        const batch = firestore.batch();
        existingInvites.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();

        let inviteRef: FirebaseFirestore.DocumentReference | null = null;
        let inviteId;
        try {
          inviteRef = invitesCollection.doc();
          inviteId = inviteRef.id;

          // create new invite record
          const record: FriendEmailInviteData = {
            sender: senderId,
            term,
            versions: sortedVersions,
            created: admin.firestore.Timestamp.fromDate(new Date()),
            link: false,
            validFor: 7 * 24 * 60 * 60,
            friend: friendId,
          };

          // Use juno to send invite email
          await sendInvitation({
            inviteId,
            senderEmail,
            friendEmail,
            term,
            versionNames,
            url: redirectURL.replace(/\/+$/, ""),
          });

          // Save the invite record only if the email was sent successfully
          await inviteRef.set(record);

          sortedVersions.forEach((v) => {
            if (!senderData.terms[term].versions[v].friends) {
              senderData.terms[term].versions[v].friends = {};
            }
            senderData.terms[term].versions[v].friends[friendId] = {
              email: friendEmail,
              status: "Pending",
            };
          });
          await schedulesCollection.doc(senderId).set(senderData);
        } catch (err) {
          functions.logger.error(
            "Error sending invite email or saving record",
            err
          );

          if (inviteRef) {
            try {
              await inviteRef.delete();
              functions.logger.warn(
                "Rolled back invite document after failure"
              );
            } catch (rollbackErr) {
              functions.logger.error(
                "Failed to roll back invite document",
                rollbackErr
              );
            }
          }

          return response
            .status(400)
            .json(apiError("Error sending invite email"));
        }

        return response.status(200).json({ inviteId });
      } catch (err) {
        console.error(err);
        return response.status(400).json(apiError("Error creating invite"));
      }
    });
  });
