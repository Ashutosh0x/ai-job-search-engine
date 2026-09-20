import { redirect } from "next/navigation"

/**
 * The former /resume experience displayed simulated scores and recommendations
 * independently of the uploaded document. Keep old links working, but direct
 * them to the evidence-backed builder instead of presenting fabricated advice.
 */
export default function ResumePage() {
  redirect("/resume-builder")
}
