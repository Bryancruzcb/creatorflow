package creatorflow.workflow;

/**
 * The scan is not a completed immutable snapshot, so nothing can honestly be evaluated against it.
 *
 * <p>A distinct type rather than a bare {@link IllegalStateException} because the routes translate
 * this precondition into <strong>409</strong>, and {@code Database.transaction} wraps every
 * {@link java.sql.SQLException} into an {@code IllegalStateException} too. Catching the supertype
 * meant a disk error, a foreign-key violation or a busy timeout was reported to the workspace as
 * "409 Could not complete database transaction" — a state-conflict answer, with an infrastructure
 * message, for something that is neither. Those now fall through to the generic 500, which is what
 * they are.
 *
 * <p>Extends {@code IllegalStateException} so existing callers that only care about "this cannot
 * proceed" keep working; the routes catch <em>this</em> type.
 */
public class ScanNotReleasableException extends IllegalStateException {

    public ScanNotReleasableException(String message) {
        super(message);
    }
}
