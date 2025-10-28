const express = require("express");
const app = express.Router();
const User = require("../model/user.js");
const Profile = require("../model/profiles.js");
const log = require("../structs/log.js");
const fs = require("fs");
const uuid = require("uuid");
const config = JSON.parse(fs.readFileSync("./Config/config.json").toString());

app.get(config.XP.callbackEndpoint, async (req, res) => {
    const { apikey, username, reason } = req.query;

    // Security & param checks
    if (!apikey || apikey !== config.Api.bApiKey) {
        return res.status(401).json({ code: "401", error: "Invalid or missing API key." });
    }
    if (!username) {
        return res.status(400).json({ code: "400", error: "Missing username." });
    }
    if (!reason) {
        return res.status(400).json({ code: "400", error: "Missing reason." });
    }

    const validReasons = config.XP.reasons;
    const xpToAdd = validReasons[reason];

    if (xpToAdd === undefined) {
        return res.status(400).json({
            code: "400",
            error: `Invalid reason. Allowed values: ${Object.keys(validReasons).join(", ")}.`
        });
    }

    const apiusername = username.trim().toLowerCase();

    try {
        const user = await User.findOne({ username_lower: apiusername });
        if (!user) return res.status(200).json({ message: "User not found." });

        const filter = { accountId: user.accountId };
        const profile = await Profile.findOne(filter);

        if (!profile || !profile.profiles.common_core) {
            return res.status(404).json({ code: "404", error: "Profile not found." });
        }

        const common_core = profile.profiles.common_core;

        // Ensure XP item exists
        if (!common_core.items["Currency:AthenaXP"]) {
            common_core.items["Currency:AthenaXP"] = {
                templateId: "Currency:AthenaXP",
                quantity: 0
            };
        }

        const oldXP = common_core.items["Currency:AthenaXP"].quantity;
        const newXP = oldXP + xpToAdd;
        common_core.items["Currency:AthenaXP"].quantity = newXP;

        // Gift log entry
        const giftId = uuid.v4();
        common_core.items[giftId] = {
            "templateId": "GiftBox:GB_MakeGood",
            "attributes": {
                "fromAccountId": "Cosmic Owner's",
                "lootList": [{
                    "itemType": "Currency:AthenaXP",
                    "itemGuid": "Currency:AthenaXP",
                    "quantity": xpToAdd
                }],
                "params": {
                    "userMessage": `XP Reward: ${reason}`
                },
                "giftedOn": new Date().toISOString()
            },
            "quantity": 1
        };

        // Increment revision counters
        common_core.rvn += 1;
        common_core.commandRevision += 1;

        const profileChanges = [
            {
                "changeType": "itemQuantityChanged",
                "itemId": "Currency:AthenaXP",
                "quantity": newXP
            },
            {
                "changeType": "itemAdded",
                "itemId": giftId,
                "templateId": "GiftBox:GB_MakeGood"
            }
        ];

        await Profile.updateOne(filter, { $set: { 'profiles.common_core': common_core } });

        return res.status(200).json({
            profileRevision: common_core.rvn,
            profileCommandRevision: common_core.commandRevision,
            profileChanges,
            addedXP: xpToAdd,
            totalXP: newXP,
            message: `Added ${xpToAdd} XP to ${username} for ${reason}`
        });

    } catch (err) {
        log.error("XP API callback error:", err);
        return res.status(500).json({ code: "500", error: "Internal server error. Check console logs." });
    }
});

module.exports = app;
