package creativeflow.model;

import java.util.ArrayList;
import java.util.List;

/** Basic project data model. */
public class Project {
    private String name;
    private String description;
    private final List<AssetFile> assets;

    public Project(String name, String description) {
        this.name = name;
        this.description = description;
        this.assets = new ArrayList<>();
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public List<AssetFile> getAssets() {
        return assets;
    }

    public void addAsset(AssetFile asset) {
        assets.add(asset);
    }
}
