import admin from "./firebase";
import * as functions from "firebase-functions";
import * as cors from "cors";
import { apiError } from "./api";

const friendsCollection = admin.firestore().collection("friends") as FirebaseFirestore.CollectionReference<FriendsData>;
const auth = admin.auth();
const schedulesCollection = admin.firestore().collection("schedules-dev");

const corsHandler = cors({ origin: true });

interface FriendsData {
  terms: Record<string, Record<string, string[]>>[];
}

type VersionReturn = Record<string, string[]>;


export const fetchFriendVersions = functions.https.onRequest(
  async (request, response) => {
    corsHandler(request, response, async () => {
      const friends = request.body.friends;
      if (friends == null || friends.length === 0) {
        response.status(200).json({});
        return;
      }

      const IDToken = request.body.IDToken;
      if (IDToken == null) {
        response.status(400).json(apiError("IDToken not provided"));
        return;
      }

      // Authenticate token id
      auth
        .verifyIdToken(IDToken)
        .then(async (decodedToken: admin.auth.DecodedIdToken) => {
          const uid = decodedToken.uid;
          // Fetch user's friends
          let userFriendData : FriendsData = await friendsCollection
            .doc(uid)
            .get()
            .then((doc) => doc.data()) as FriendsData;

          if (userFriendData == null) {
            response.status(400).json(apiError("user not found"));
            return;
          }
          const friendList = userFriendData.terms[request.body.term];
          const accesibleFriends = friends.filter((friend: string) =>
            Object.keys(friendList).includes(friend)
          );
          const friendVersionsReturn : VersionReturn = {};
          await Promise.all(
            Object.keys(accesibleFriends).map(async (friend: string) => {
              const userVersions = await schedulesCollection
                .doc(friend)
                .get()
                .then((doc) => doc.data()?.terms[request.body.term].versions);
              const friend_email = await admin
                .auth()
                .getUser(friend)
                .then((user) => user.email);
              if (friend_email == null) {
                response.status(400).json(apiError("friend email not found"));
                return;
              }
              const versionsNeeded = Object.keys(userVersions).filter(
                (version: string) => friends[friend].includes(version)
              );
              const versions = versionsNeeded.map(
                (version: string) => userVersions[version]
              );
              friendVersionsReturn[friend_email] = versions;
            })
          );
          response.status(200).json(friendVersionsReturn);
        })
        .catch((error) => {
          response.status(400).json(apiError("invalid IDToken"));
          return;
        });
    });
  }
);
