module creatorflow {
    requires javafx.controls;
    requires javafx.fxml;

    exports creativeflow;
    exports creativeflow.view;
    exports creativeflow.component;
    exports creativeflow.model;
    exports creativeflow.controller;

    opens creativeflow to javafx.graphics, javafx.fxml;
    opens creativeflow.view to javafx.fxml;
    opens creativeflow.controller to javafx.fxml;
}
