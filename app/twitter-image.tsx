import { socialImage, socialImageAlt, socialImageSize } from "@/lib/social-card";

export const alt = socialImageAlt;
export const size = socialImageSize;
export const contentType = "image/png";

export default function TwitterImage() {
  return socialImage();
}
