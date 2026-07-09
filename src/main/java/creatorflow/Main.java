package creatorflow;

/**
 * Launcher that does not extend {@code javafx.application.Application}, so the
 * app starts from a plain classpath (`mvn javafx:run`, IDE run, or a fat jar)
 * without module-path ceremony.
 */
public final class Main {

    private Main() {
    }

    public static void main(String[] args) {
        javafx.application.Application.launch(App.class, args);
    }
}
