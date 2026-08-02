/**
 * The composed dictionary.
 *
 * ONE MODULE PER SURFACE. That is a collision-avoidance decision as much as a
 * tidiness one: the per-screen translation sweep runs several contributors at
 * once, and a single shared dictionary is the one file they would ALL have to
 * edit. Every module is registered here up front — including empty ones — so
 * adding strings never means touching this file either.
 */
import { CORE } from "./core";
import { AUTH } from "./auth";
import { NAV } from "./nav";
import { DIALER } from "./dialer";
import { HISTORY } from "./history";
import { MESSAGES } from "./messages";
import { CONTACTS } from "./contacts";
import { PROFILE } from "./profile";
import { CALLS } from "./calls";
import { STATUS } from "./status";
import { INVITE } from "./invite";
import { GROUPS } from "./groups";
import { ADMIN } from "./admin";
import { ENGINE } from "./engine";
import { ALERTS } from "./alerts";
import { VOICEMAIL } from "./voicemail";
import { VIDEOREC } from "./videorec";
import { IMAGEEDIT } from "./imageedit";
import { PEER } from "./peer";
import { GROUPCALL } from "./groupcall";

export const ALL_DICT = {
  ...CORE,
  ...AUTH,
  ...NAV,
  ...DIALER,
  ...HISTORY,
  ...MESSAGES,
  ...CONTACTS,
  ...PROFILE,
  ...CALLS,
  ...STATUS,
  ...INVITE,
  ...GROUPS,
  ...ADMIN,
  ...ENGINE,
  ...ALERTS,
  ...VOICEMAIL,
  ...VIDEOREC,
  ...IMAGEEDIT,
  ...PEER,
  ...GROUPCALL,
} as const;
