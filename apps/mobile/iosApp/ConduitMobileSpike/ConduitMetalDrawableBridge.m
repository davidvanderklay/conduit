#import "ConduitMetalDrawableBridge.h"
#import <objc/message.h>

BOOL ConduitAddMetalDrawablePresentedHandler(
    id<MTLDrawable> drawable,
    ConduitMetalDrawablePresentedHandler handler
) {
    SEL selector = NSSelectorFromString(@"addPresentedHandler:");
    if (![drawable respondsToSelector:selector]) {
        return NO;
    }

    typedef void (*ConduitAddPresentedHandler)(id, SEL, id);
    ConduitAddPresentedHandler addPresentedHandler =
        (ConduitAddPresentedHandler)objc_msgSend;
    ConduitMetalDrawablePresentedHandler presentedHandler =
        ^(id<MTLDrawable> presentedDrawable) {
            id<CAMetalDrawable> metalDrawable = (id<CAMetalDrawable>)presentedDrawable;
            handler(metalDrawable.texture);
        };
    addPresentedHandler(drawable, selector, presentedHandler);
    return YES;
}
