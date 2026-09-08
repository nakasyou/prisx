import "solid-js";
declare module "solid-js" {
  namespace JSX {
    interface CustomCaptureEvents {
      scroll: Event;
    }
  }
}
