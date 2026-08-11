package org.redcastlemedia.multitallented.civs.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import org.junit.runner.RunWith;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.junit.ArchUnitRunner;
import com.tngtech.archunit.lang.ArchRule;

/**
 * Phase-1 package contracts for Civs (#43). Expand gradually; keep rules green.
 * Note: regions→menus coupling exists historically (29 edges) — defer to a dedicated
 * layering refactor issue rather than failing CI on day one.
 */
@RunWith(ArchUnitRunner.class)
@AnalyzeClasses(
        packages = "org.redcastlemedia.multitallented.civs",
        importOptions = ImportOption.DoNotIncludeTests.class)
public class ArchitectureRulesTest {

    @ArchTest
    public static final ArchRule mainCodeDoesNotDependOnJUnitOrMockito =
            noClasses()
                    .that()
                    .resideInAPackage("org.redcastlemedia.multitallented.civs..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage("org.junit..", "org.mockito..", "org.hamcrest..")
                    .because("production plugin code must not depend on test libraries");

    @ArchTest
    public static final ArchRule mainCodeDoesNotDependOnJdkInternalApis =
            noClasses()
                    .that()
                    .resideInAPackage("org.redcastlemedia.multitallented.civs..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage("sun..", "com.sun..", "jdk.internal..")
                    .because("plugin code must stay on supported public JDK / Paper APIs");
}
