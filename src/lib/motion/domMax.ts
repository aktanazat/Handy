import { domMax } from "motion/react";

/* The `domMax` feature bundle: `domAnimation` plus drag, pan and layout
 * projection. Only surfaces that actually drag or share layout between elements
 * load it, and they load it through this module so it lands in its own async
 * chunk rather than in the eager one. See domAnimation.ts for why the bundle
 * gets a module of its own. */
export default domMax;
