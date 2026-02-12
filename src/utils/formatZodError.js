export function formatZodError(error) {
    return error?.issues ?? error?.errors ?? error;
}
