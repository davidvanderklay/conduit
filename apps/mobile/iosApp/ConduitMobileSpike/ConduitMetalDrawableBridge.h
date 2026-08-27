#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^ConduitMetalDrawablePresentedHandler)(id<MTLDrawable> drawable);

FOUNDATION_EXPORT BOOL ConduitAddMetalDrawablePresentedHandler(
    id<MTLDrawable> drawable,
    ConduitMetalDrawablePresentedHandler handler
);

NS_ASSUME_NONNULL_END
