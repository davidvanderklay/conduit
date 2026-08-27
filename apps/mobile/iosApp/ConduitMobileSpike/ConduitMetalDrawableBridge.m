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
    typedef void (^ConduitPresentedHandler)(id<MTLDrawable> drawable);
    ConduitPresentedHandler presentedHandler =
        ^(id<MTLDrawable> presentedDrawable) {
            SEL textureSelector = NSSelectorFromString(@"texture");
            if (![presentedDrawable respondsToSelector:textureSelector]) {
                return;
            }
            typedef id<MTLTexture> (*ConduitGetTexture)(id, SEL);
            ConduitGetTexture getTexture = (ConduitGetTexture)objc_msgSend;
            id<MTLTexture> texture = getTexture(presentedDrawable, textureSelector);
            if (texture != nil) {
                handler(texture);
            }
        };
    addPresentedHandler(drawable, selector, presentedHandler);
    return YES;
}
