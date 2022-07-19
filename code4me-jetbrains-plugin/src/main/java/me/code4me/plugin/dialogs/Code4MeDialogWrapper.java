package me.code4me.plugin.dialogs;

import com.intellij.openapi.ui.DialogWrapper;
import me.code4me.plugin.Code4MeBundle;

import javax.annotation.Nullable;
import javax.swing.Box;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.awt.Dimension;

public class Code4MeDialogWrapper extends DialogWrapper {

    private static final int WIDTH = 330;
    private static final int HEIGHT = 270;

    private final JPanel dialogPanel = new JPanel(new BorderLayout());
    private final JLabel contentLabel = new JLabel();
    private final JCheckBox triggerPoints = new JCheckBox();
    private final JCheckBox storeContext = new JCheckBox();

    public Code4MeDialogWrapper() {
        super(true);
        setTitle(Code4MeBundle.message("settings-title"));
        init();
        pack();
        setResizable(false);
    }

    @Nullable
    @Override
    protected JComponent createCenterPanel() {
        Dimension dimension = new Dimension(WIDTH, HEIGHT);
        dialogPanel.setPreferredSize(dimension);
        dialogPanel.setMinimumSize(dimension);
        dialogPanel.setMaximumSize(dimension);

        contentLabel.setText("<html>" + Code4MeBundle.message("settings-content") + "</html>");
        triggerPoints.setText(Code4MeBundle.message("settings-trigger-points"));
        storeContext.setText(Code4MeBundle.message("settings-store-context"));

        Box box = Box.createVerticalBox();
        box.add(contentLabel);
        box.add(triggerPoints);
        box.add(storeContext);

        dialogPanel.add(box);

        return dialogPanel;
    }

    public boolean isTriggerPointsSelected() {
        return triggerPoints.isSelected();
    }

    public void setTriggerPointsSelected(boolean selected) {
        triggerPoints.setSelected(selected);
    }

    public boolean isStoreContextSelected() {
        return storeContext.isSelected();
    }

    public void setStoreContextSelected(boolean selected) {
        storeContext.setSelected(selected);
    }

}
